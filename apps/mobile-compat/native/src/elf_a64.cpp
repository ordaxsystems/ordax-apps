#include "ordax/mobile/elf_a64.hpp"

#include <algorithm>
#include <array>
#include <vector>

namespace ordax::mobile {
namespace {
constexpr std::uint32_t kLoad = 1;
constexpr std::uint32_t kDynamic = 2;
constexpr std::uint32_t kInterpreter = 3;
constexpr std::uint32_t kTls = 7;
constexpr std::uint16_t kElfExecutable = 2;
constexpr std::uint16_t kElfShared = 3;
constexpr std::uint16_t kArm64Machine = 183;
constexpr std::uint32_t kWritable = 2;
constexpr std::uint32_t kExecutable = 1;
constexpr std::size_t kHeaderBytes = 64;
constexpr std::size_t kProgramBytes = 56;
constexpr std::size_t kRelaBytes = 24;
constexpr std::uint32_t kAarch64Relative = 1027;

void range(std::size_t offset, std::size_t length, std::size_t size) {
    if (offset > size || length > size - offset) throw GuestFault("ELF field outside input");
}
std::uint16_t get16(std::span<const std::uint8_t> b, std::size_t p) {
    range(p, 2, b.size());
    return std::uint16_t(b[p]) | (std::uint16_t(b[p + 1]) << 8);
}
std::uint32_t get32(std::span<const std::uint8_t> b, std::size_t p) {
    range(p, 4, b.size());
    return std::uint32_t(b[p]) | (std::uint32_t(b[p + 1]) << 8) |
           (std::uint32_t(b[p + 2]) << 16) | (std::uint32_t(b[p + 3]) << 24);
}
std::uint64_t get64(std::span<const std::uint8_t> b, std::size_t p) {
    return std::uint64_t(get32(b, p)) | (std::uint64_t(get32(b, p + 4)) << 32);
}

struct Segment {
    std::uint64_t address;
    std::uint64_t vaddr;
    std::size_t mem_bytes;
    std::size_t file_bytes;
    std::size_t file_offset;
    std::uint32_t flags;
};
struct DynamicSection {
    std::size_t file_offset;
    std::size_t file_bytes;
    std::uint64_t vaddr;
};
struct Relocation {
    std::uint64_t destination;
    std::uint64_t value;
};

bool holds(const Segment& segment, std::uint64_t address, std::uint64_t bytes) {
    return address >= segment.address &&
           address - segment.address <= segment.mem_bytes &&
           bytes <= segment.mem_bytes - (address - segment.address);
}
bool inMapped(const std::vector<Segment>& segments, std::uint64_t address,
              std::uint64_t bytes, std::uint32_t required_flags = 0) {
    return std::any_of(segments.begin(), segments.end(), [&](const auto& s) {
        return (s.flags & required_flags) == required_flags && holds(s, address, bytes);
    });
}
std::uint64_t checkedAddress(std::uint64_t vaddr, std::uint64_t bias,
                             std::size_t count, std::size_t memory_bytes) {
    if (bias > memory_bytes || vaddr > memory_bytes - bias ||
        count > memory_bytes - static_cast<std::size_t>(bias + vaddr)) {
        throw GuestFault("ELF address outside guest memory");
    }
    return vaddr + bias;
}
std::size_t mappedFileOffset(std::uint64_t virtual_address, std::size_t bytes,
                             const std::vector<Segment>& segments) {
    for (const auto& segment : segments) {
        if (virtual_address < segment.vaddr) continue;
        const auto delta = virtual_address - segment.vaddr;
        if (delta <= segment.file_bytes && bytes <= segment.file_bytes - delta) {
            return segment.file_offset + static_cast<std::size_t>(delta);
        }
    }
    throw GuestFault("ELF relocation table is not within file-backed PT_LOAD");
}

std::vector<Relocation> parseRelativeRelocations(
    std::span<const std::uint8_t> elf, const DynamicSection& dynamic,
    const std::vector<Segment>& segments, std::uint64_t bias,
    std::size_t memory_bytes) {
    if (!dynamic.file_bytes || dynamic.file_bytes % 16 != 0 ||
        dynamic.file_bytes / 16 > 512) {
        throw GuestFault("Invalid or unbounded ELF dynamic section");
    }
    bool terminated = false;
    bool has_rela = false, has_relasz = false, has_relaent = false;
    bool has_relacount = false;
    std::uint64_t rela = 0, relasz = 0, relaent = 0, relacount = 0;
    for (std::size_t i = 0; i < dynamic.file_bytes; i += 16) {
        const auto offset = dynamic.file_offset + i;
        const auto tag = get64(elf, offset);
        const auto value = get64(elf, offset + 8);
        if (tag == 0) { terminated = true; break; }
        switch (tag) {
            case 7: // DT_RELA
                if (has_rela) throw GuestFault("Repeated DT_RELA");
                has_rela = true; rela = value; break;
            case 8: // DT_RELASZ
                if (has_relasz) throw GuestFault("Repeated DT_RELASZ");
                has_relasz = true; relasz = value; break;
            case 9: // DT_RELAENT
                if (has_relaent) throw GuestFault("Repeated DT_RELAENT");
                has_relaent = true; relaent = value; break;
            case 0x6ffffff9: // DT_RELACOUNT
                if (has_relacount) throw GuestFault("Repeated DT_RELACOUNT");
                has_relacount = true; relacount = value; break;
            default:
                // Especially DT_NEEDED, DT_JMPREL, DT_RELR and constructors.
                // They require real dependency resolution and Android lifecycle.
                throw GuestFault("Unsupported Android dynamic linker tag");
        }
    }
    if (!terminated) throw GuestFault("Unterminated ELF dynamic section");
    if (!has_rela && !has_relasz && !has_relaent && !has_relacount) return {};
    if (!(has_rela && has_relasz && has_relaent) || relaent != kRelaBytes ||
        relasz % kRelaBytes != 0 || relasz / kRelaBytes > 8192 ||
        (has_relacount && relacount != relasz / kRelaBytes)) {
        throw GuestFault("Malformed or unsupported DT_RELA metadata");
    }
    const auto count = static_cast<std::size_t>(relasz / kRelaBytes);
    const auto source = mappedFileOffset(rela, static_cast<std::size_t>(relasz), segments);
    std::vector<Relocation> patches;
    patches.reserve(count);
    for (std::size_t i = 0; i < count; ++i) {
        const auto offset = source + i * kRelaBytes;
        const auto target = get64(elf, offset);
        const auto info = get64(elf, offset + 8);
        const auto addend = get64(elf, offset + 16);
        if ((info & 0xffffffffu) != kAarch64Relative || (info >> 32) != 0) {
            throw GuestFault("Relocation requires unresolved Android symbol or type");
        }
        const auto destination = checkedAddress(target, bias, 8, memory_bytes);
        if (destination % 8 != 0 || !inMapped(segments, destination, 8, kWritable)) {
            throw GuestFault("Relocation destination is not a writable PT_LOAD");
        }
        // ELF64 r_addend is signed. Two's complement arithmetic here is
        // intentional; validate the resulting guest pointer before using it.
        const auto value = bias + addend;
        if (!inMapped(segments, value, 1)) {
            throw GuestFault("Relative relocation value escapes the mapped image");
        }
        if (std::any_of(patches.begin(), patches.end(), [&](const auto& p) {
                return p.destination == destination;
            })) {
            throw GuestFault("Duplicate ELF relocation destination");
        }
        patches.push_back({destination, value});
    }
    return patches;
}
LoadedGuestElf loadElf(CpuA64& cpu, std::span<const std::uint8_t> elf,
                       std::uint64_t bias, std::uint16_t expected_type) {
    range(0, kHeaderBytes, elf.size());
    if (elf[0] != 0x7f || elf[1] != 'E' || elf[2] != 'L' || elf[3] != 'F' ||
        elf[4] != 2 || elf[5] != 1 || elf[6] != 1 ||
        get16(elf, 16) != expected_type ||
        get16(elf, 18) != kArm64Machine || get32(elf, 20) != 1) {
        throw GuestFault("Expected supported AArch64 ELF64 little-endian image");
    }
    if (bias % 4096 != 0) throw GuestFault("Guest ELF load bias is not page-aligned");

    const auto raw_entry = get64(elf, 24);
    const auto phoff = get64(elf, 32);
    const std::size_t phnum = get16(elf, 56);
    if (get16(elf, 54) != kProgramBytes || phnum == 0 || phnum > 128 ||
        phoff > elf.size() || phnum * kProgramBytes > elf.size() - static_cast<std::size_t>(phoff)) {
        throw GuestFault("Invalid ELF program header table");
    }

    std::vector<Segment> segments;
    std::vector<DynamicSection> dynamic_sections;
    for (std::size_t i = 0; i < phnum; ++i) {
        const auto at = static_cast<std::size_t>(phoff) + i * kProgramBytes;
        const auto type = get32(elf, at);
        const auto flags = get32(elf, at + 4);
        const auto off = get64(elf, at + 8);
        const auto vaddr = get64(elf, at + 16);
        const auto filesz = get64(elf, at + 32);
        const auto memsz = get64(elf, at + 40);
        if (type == kInterpreter || type == kTls) {
            throw GuestFault("ELF interpreter or guest TLS requires Android runtime");
        }
        if (type == kDynamic) {
            if (expected_type != kElfShared) throw GuestFault("Static ELF requires unsupported dynamic linking");
            if (off > elf.size() || filesz > elf.size() - off ||
                filesz > 8192 || dynamic_sections.size() != 0) {
                throw GuestFault("Invalid or repeated PT_DYNAMIC");
            }
            dynamic_sections.push_back({static_cast<std::size_t>(off), static_cast<std::size_t>(filesz), vaddr});
            continue;
        }
        if (type != kLoad) continue;
        if (segments.size() >= 64 || off > elf.size() || filesz > elf.size() - off ||
            memsz < filesz || memsz == 0 || memsz > cpu.memory_size()) {
            throw GuestFault("Invalid ELF PT_LOAD bounds");
        }
        const auto guest = checkedAddress(vaddr, bias, static_cast<std::size_t>(memsz), cpu.memory_size());
        for (const auto& existing : segments) {
            if (guest < existing.address + existing.mem_bytes &&
                existing.address < guest + memsz) {
                throw GuestFault("Overlapping ELF load segments");
            }
        }
        // W+X segment is unsupported by this minimal trust boundary.
        if ((flags & (kWritable | kExecutable)) == (kWritable | kExecutable)) {
            throw GuestFault("Writable executable guest mapping is prohibited");
        }
        segments.push_back({guest, vaddr, static_cast<std::size_t>(memsz),
                            static_cast<std::size_t>(filesz),
                            static_cast<std::size_t>(off), flags});
    }
    if (segments.empty()) throw GuestFault("ELF has no PT_LOAD segment");
    const bool has_entry = raw_entry != 0 || expected_type == kElfExecutable;
    const auto entry = has_entry ? checkedAddress(raw_entry, bias, 4, cpu.memory_size()) : 0;
    if (has_entry && (entry % 4 != 0 || !inMapped(segments, entry, 4, kExecutable))) {
        throw GuestFault("ELF entry is outside an executable guest segment");
    }

    std::vector<Relocation> patches;
    if (!dynamic_sections.empty()) {
        const auto& dynamic = dynamic_sections.front();
        if (mappedFileOffset(dynamic.vaddr, dynamic.file_bytes, segments) != dynamic.file_offset ||
            !inMapped(segments, checkedAddress(dynamic.vaddr, bias, dynamic.file_bytes, cpu.memory_size()),
                      dynamic.file_bytes)) {
            throw GuestFault("PT_DYNAMIC is not backed by the mapped guest image");
        }
        patches = parseRelativeRelocations(elf, dynamic, segments, bias, cpu.memory_size());
    }

    // No guest mutation until every header, segment, relocation and entry is
    // validated. No host code is executed by the loader.
    for (const auto& segment : segments) {
        std::vector<std::uint8_t> bytes(segment.mem_bytes, 0);
        std::copy(elf.begin() + static_cast<std::ptrdiff_t>(segment.file_offset),
                  elf.begin() + static_cast<std::ptrdiff_t>(segment.file_offset + segment.file_bytes),
                  bytes.begin());
        cpu.load(segment.address, bytes);
    }
    for (const auto& patch : patches) {
        std::array<std::uint8_t, 8> bytes{};
        for (unsigned i = 0; i < 8; ++i) {
            bytes[i] = static_cast<std::uint8_t>(patch.value >> (8 * i));
        }
        cpu.load(patch.destination, bytes);
    }
    std::vector<GuestRegion> protections;
    protections.reserve(segments.size());
    for (const auto& segment : segments) {
        protections.push_back({segment.address, segment.mem_bytes,
                               static_cast<std::uint8_t>(segment.flags & 7u)});
    }
    cpu.set_guest_regions(protections);
    return {entry, segments.size(), bias, patches.size(), has_entry};
}
} // namespace

LoadedGuestElf loadStaticElfA64(CpuA64& cpu, std::span<const std::uint8_t> elf) {
    return loadElf(cpu, elf, 0, kElfExecutable);
}
LoadedGuestElf loadRelocatableElfA64(CpuA64& cpu,
                                    std::span<const std::uint8_t> elf,
                                    std::uint64_t load_bias) {
    return loadElf(cpu, elf, load_bias, kElfShared);
}
} // namespace ordax::mobile
