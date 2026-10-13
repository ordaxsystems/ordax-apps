#include "ordax/mobile/cpu_a64.hpp"

#include <algorithm>
#include <bit>
#include <limits>

namespace ordax::mobile {
namespace {
constexpr std::uint64_t kReturnToHost = std::numeric_limits<std::uint64_t>::max();
constexpr std::size_t kMaximumMemory = 64u * 1024u * 1024u;
}

CpuA64::CpuA64(std::size_t memory_bytes) {
    if (memory_bytes < 4096 || memory_bytes > kMaximumMemory) {
        throw GuestFault("Invalid guest memory allocation");
    }
    memory_.resize(memory_bytes);
}
void CpuA64::assert_range(std::uint64_t address, std::size_t count) const {
    if (address > memory_.size() || count > memory_.size() - static_cast<std::size_t>(address)) {
        throw GuestFault("Guest memory access outside allocation");
    }
}
void CpuA64::verify_new_guest_regions(std::span<const GuestRegion> regions) const {
    if (regions.empty() || regions.size() > 64 ||
        guest_regions_.size() > 64 - regions.size()) {
        throw GuestFault("Invalid guest protection table size");
    }
    for (std::size_t i = 0; i < regions.size(); ++i) {
        const auto& current = regions[i];
        assert_range(current.address, current.length);
        if (!current.length || (current.permissions & ~std::uint8_t(7)) != 0) {
            throw GuestFault("Invalid guest segment protection");
        }
        for (std::size_t j = 0; j < i; ++j) {
            const auto& other = regions[j];
            if (current.address < other.address + other.length &&
                other.address < current.address + current.length) {
                throw GuestFault("Overlapping guest protection regions");
            }
        }
        for (const auto& existing : guest_regions_) {
            if (current.address < existing.address + existing.length &&
                existing.address < current.address + current.length) {
                throw GuestFault("Guest ELF collides with previously mapped guest library");
            }
        }
    }
}
void CpuA64::set_guest_regions(std::span<const GuestRegion> regions) {
    verify_new_guest_regions(regions);
    guest_regions_.insert(guest_regions_.end(), regions.begin(), regions.end());
    protected_guest_ = true;
}
void CpuA64::install_host_readonly(std::uint64_t address,
                                   std::span<const std::uint8_t> bytes) {
    if (!protected_guest_ || bytes.empty() || address % 8 != 0 ||
        bytes.size() > 4096 || guest_regions_.size() >= 64) {
        throw GuestFault("Invalid trusted host memory mapping");
    }
    assert_range(address, bytes.size());
    for (const auto& region : guest_regions_) {
        if (address < region.address + region.length &&
            region.address < address + bytes.size()) {
            throw GuestFault("Host JNI data overlaps guest memory mapping");
        }
    }
    // Trusted-only image staging: not an exposed guest memory write.
    load(address, bytes);
    guest_regions_.push_back({address, bytes.size(), 4});
}
void CpuA64::set_host_call(HostCall call) {
    if (!protected_guest_ || !call) throw GuestFault("Host callback requires protected guest");
    host_call_ = std::move(call);
}
void CpuA64::require_permission(std::uint64_t address, std::size_t count,
                                 std::uint8_t flag) const {
    if (!protected_guest_) return; // bare instruction tests without an ELF
    for (const auto& region : guest_regions_) {
        if (address >= region.address &&
            address - region.address <= region.length &&
            count <= region.length - (address - region.address) &&
            (region.permissions & flag) == flag) return;
    }
    throw GuestFault("Guest page permission violation");
}
void CpuA64::require_guest_access(std::uint64_t address, std::size_t count,
                                   std::uint8_t permission) const {
    assert_range(address, count);
    require_permission(address, count, permission);
}
std::uint64_t CpuA64::guest_read_u64(std::uint64_t address) const {
    return read64(address); // checks PF_R on the whole slot
}
void CpuA64::guest_write_u64(std::uint64_t address, std::uint64_t value) {
    if (address % 8) throw GuestFault("Unaligned JNI pointer output");
    write64(address, value); // checks PF_W on the whole slot
}
std::uint8_t CpuA64::guest_read_u8(std::uint64_t address) const {
    require_guest_access(address, 1, 4); // PF_R
    return memory_[static_cast<std::size_t>(address)];
}
std::int32_t CpuA64::guest_read_i32(std::uint64_t address) const {
    require_guest_access(address, 4, 4); // PF_R
    const auto index = static_cast<std::size_t>(address);
    std::uint32_t word = 0;
    for (unsigned i = 0; i < 4; ++i) {
        word |= std::uint32_t(memory_[index + i]) << (8 * i);
    }
    return std::bit_cast<std::int32_t>(word);
}
void CpuA64::guest_write_i32(std::uint64_t address, std::int32_t value) {
    require_guest_access(address, 4, 2); // PF_W
    const auto index = static_cast<std::size_t>(address);
    const auto word = std::bit_cast<std::uint32_t>(value);
    for (unsigned i = 0; i < 4; ++i) {
        memory_[index + i] = static_cast<std::uint8_t>(word >> (8 * i));
    }
}
void CpuA64::load(std::uint64_t address, std::span<const std::uint8_t> bytes) {
    assert_range(address, bytes.size());
    std::copy(bytes.begin(), bytes.end(), memory_.begin() + static_cast<std::ptrdiff_t>(address));
}
std::uint32_t CpuA64::read32(std::uint64_t address) const {
    assert_range(address, 4);
    require_permission(address, 4, 1); // PF_X, instruction fetch only
    std::uint32_t value = 0;
    for (int shift = 0; shift < 32; shift += 8) {
        value |= std::uint32_t(memory_[static_cast<std::size_t>(address) + shift / 8]) << shift;
    }
    return value;
}
std::uint64_t CpuA64::read64(std::uint64_t address) const {
    assert_range(address, 8);
    require_permission(address, 8, 4); // PF_R
    std::uint64_t value = 0;
    for (int shift = 0; shift < 64; shift += 8) {
        value |= std::uint64_t(memory_[static_cast<std::size_t>(address) + shift / 8]) << shift;
    }
    return value;
}
void CpuA64::write64(std::uint64_t address, std::uint64_t value) {
    assert_range(address, 8);
    require_permission(address, 8, 2); // PF_W
    for (int shift = 0; shift < 64; shift += 8) {
        memory_[static_cast<std::size_t>(address) + shift / 8] = static_cast<std::uint8_t>(value >> shift);
    }
}
std::uint64_t CpuA64::reg(unsigned index) const {
    if (index > 31) throw GuestFault("Invalid register index");
    return index == 31 ? 0 : registers_[index];
}
void CpuA64::store_register(unsigned index, std::uint64_t value) {
    if (index > 31) throw GuestFault("Invalid register index");
    if (index != 31) registers_[index] = value;
}
void CpuA64::set_register(unsigned index, std::uint64_t value) {
    if (index >= 31) throw GuestFault("Only x0-x30 supported for host input");
    registers_[index] = value;
}
std::uint64_t CpuA64::run(std::uint64_t entry, std::uint64_t max_instructions) {
    if (!max_instructions || max_instructions > 1000000) {
        throw GuestFault("Invalid instruction budget");
    }
    if (entry % 4 != 0) throw GuestFault("Unaligned guest entry");
    registers_[30] = kReturnToHost;
    std::uint64_t pc = entry;
    for (std::uint64_t tick = 0; tick < max_instructions; ++tick) {
        if (pc % 4 != 0) throw GuestFault("Unaligned guest program counter");
        const std::uint32_t opcode = read32(pc);
        const unsigned rd = opcode & 31u;
        const unsigned rn = (opcode >> 5) & 31u;
        std::uint64_t next = pc + 4;
        if ((opcode & 0xff800000u) == 0xd2800000u) { // MOVZ Xd, #imm, LSL #shift
            const unsigned shift = ((opcode >> 21) & 3u) * 16u;
            store_register(rd, std::uint64_t((opcode >> 5) & 0xffffu) << shift);
        } else if ((opcode & 0xff800000u) == 0xf2800000u) { // MOVK Xd, #imm, LSL #shift
            const unsigned shift = ((opcode >> 21) & 3u) * 16u;
            const std::uint64_t mask = std::uint64_t(0xffffu) << shift;
            store_register(rd, (reg(rd) & ~mask) | (std::uint64_t((opcode >> 5) & 0xffffu) << shift));
        } else if ((opcode & 0x9f000000u) == 0x90000000u) { // ADRP Xd, PC-relative page
            const std::uint32_t imm = ((opcode >> 29) & 3u) |
                                      (((opcode >> 5) & 0x7ffffu) << 2);
            const std::int64_t pages = (imm & (1u << 20))
                ? std::int64_t(imm) - (1ll << 21) : std::int64_t(imm);
            const auto page = pc & ~std::uint64_t(4095);
            store_register(rd, page + static_cast<std::uint64_t>(pages * 4096));
        } else if ((opcode & 0xff200000u) == 0xaa000000u) { // ORR Xd,Xn,Xm,LSL #imm
            // MOV Xd,Xm is the architectural alias ORR Xd,XZR,Xm.
            // Respect XZR on both inputs and destination; no host pointer
            // or stack-register special case is permitted.
            const unsigned rm = (opcode >> 16) & 31u;
            const unsigned shift = (opcode >> 10) & 63u;
            store_register(rd, reg(rn) | (reg(rm) << shift));
        } else if ((opcode & 0xff200000u) == 0x8b000000u) { // ADD Xd,Xn,Xm (unshifted)
            if ((opcode & (3u << 22)) != 0 || ((opcode >> 10) & 63u) != 0) {
                throw GuestFault("Unsupported shifted-register ADD");
            }
            const unsigned rm = (opcode >> 16) & 31u;
            store_register(rd, reg(rn) + reg(rm));
        } else if ((opcode & 0xff000000u) == 0x91000000u ||
                   (opcode & 0xff000000u) == 0xd1000000u) { // ADD/SUB immediate
            if (rn == 31 || (opcode & 0x00800000u)) throw GuestFault("Unsupported stack/shift mode");
            const unsigned shift = (opcode >> 22) & 1u;
            const std::uint64_t immediate = std::uint64_t((opcode >> 10) & 0xfffu) << (shift ? 12u : 0u);
            const auto lhs = reg(rn);
            const auto result = (opcode & 0x40000000u) ? lhs - immediate : lhs + immediate;
            store_register(rd, result);
        } else if ((opcode & 0xffc00000u) == 0xf9000000u ||
                   (opcode & 0xffc00000u) == 0xf9400000u) { // STR/LDR Xt, [Xn, #imm]
            if (rn == 31) throw GuestFault("SP addressing not implemented");
            const std::uint64_t offset = std::uint64_t((opcode >> 10) & 0xfffu) * 8u;
            const std::uint64_t address = reg(rn) + offset;
            if ((opcode & 0x00400000u) != 0) store_register(rd, read64(address));
            else write64(address, reg(rd));
        } else if ((opcode & 0xfc000000u) == 0x14000000u) { // B immediate
            const std::int32_t field = static_cast<std::int32_t>(opcode & 0x03ffffffu);
            const std::int64_t signed_offset = (field & (1 << 25)) ? std::int64_t(field) - (1 << 26) : field;
            next = pc + static_cast<std::uint64_t>(signed_offset * 4);
        } else if ((opcode & 0xfffffc1fu) == 0xd63f0000u) { // BLR Xn
            if (rn == 31) throw GuestFault("BLR XZR invalid");
            const auto target = reg(rn);
            store_register(30, pc + 4);
            if ((target & 0xffff000000000000ull) == kHostCallPrefix) {
                if (!host_call_) throw GuestFault("Unregistered JNI host call target");
                std::array<std::uint64_t, 8> args{};
                for (unsigned i = 0; i < args.size(); ++i) args[i] = reg(i);
                store_register(0, host_call_(target, args));
            } else {
                next = target; // regular guest function call
            }
        } else if ((opcode & 0xfffffc1fu) == 0xd65f0000u) { // RET Xn
            if (rn == 31) throw GuestFault("RET XZR invalid");
            next = reg(rn);
            if (next == kReturnToHost) return reg(0);
        } else if (opcode == 0xd503201fu) { // NOP
            // This is an actual architectural NOP.
        } else {
            throw GuestFault("Unsupported AArch64 instruction");
        }
        pc = next;
    }
    throw GuestFault("Guest instruction budget exhausted");
}
} // namespace ordax::mobile
