#include "ordax/mobile/elf_a64.hpp"

#include <algorithm>
#include <array>
#include <vector>

namespace ordax::mobile {
namespace {
constexpr std::uint32_t kLoad = 1;
constexpr std::uint32_t kDynamic = 2;
constexpr std::uint32_t kInterpreter = 3;
constexpr std::size_t kHeaderBytes = 64;
constexpr std::size_t kProgramBytes = 56;
constexpr std::uint16_t kArm64Machine = 183;
constexpr std::uint16_t kExecutableElf = 2;

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
    std::size_t address, mem_bytes, file_bytes, offset;
    std::uint32_t flags;
};
} // namespace

LoadedGuestElf loadStaticElfA64(CpuA64& cpu, std::span<const std::uint8_t> elf) {
    range(0, kHeaderBytes, elf.size());
    if (elf[0] != 0x7f || elf[1] != 'E' || elf[2] != 'L' || elf[3] != 'F' ||
        elf[4] != 2 || elf[5] != 1 || elf[6] != 1 || get16(elf, 16) != kExecutableElf ||
        get16(elf, 18) != kArm64Machine || get32(elf, 20) != 1) {
        throw GuestFault("Expected static AArch64 ELF64 little-endian executable");
    }
    const std::uint64_t entry = get64(elf, 24);
    const std::uint64_t phoff = get64(elf, 32);
    const std::size_t phnum = get16(elf, 56);
    if (get16(elf, 54) != kProgramBytes || phnum == 0 || phnum > 128 ||
        phoff > elf.size() || phnum * kProgramBytes > elf.size() - static_cast<std::size_t>(phoff)) {
        throw GuestFault("Invalid ELF program header table");
    }

    // Validate all segments and their relationships BEFORE mutating guest memory.
    std::vector<Segment> segments;
    for (std::size_t i = 0; i < phnum; ++i) {
        const auto at = static_cast<std::size_t>(phoff) + i * kProgramBytes;
        const auto type = get32(elf, at);
        if (type == kDynamic || type == kInterpreter) {
            throw GuestFault("Android dynamic linking is not implemented");
        }
        if (type != kLoad) continue;
        const auto flags = get32(elf, at + 4);
        const auto off = get64(elf, at + 8);
        const auto addr = get64(elf, at + 16);
        const auto filesz = get64(elf, at + 32);
        const auto memsz = get64(elf, at + 40);
        if (off > elf.size() || filesz > elf.size() - off || memsz < filesz ||
            addr > cpu.memory_size() || memsz > cpu.memory_size() - addr || memsz == 0) {
            throw GuestFault("ELF load segment outside permitted input or guest memory");
        }
        for (const auto& existing : segments) {
            if (addr < existing.address + existing.mem_bytes &&
                existing.address < addr + memsz) {
                throw GuestFault("Overlapping ELF load segments");
            }
        }
        segments.push_back({static_cast<std::size_t>(addr), static_cast<std::size_t>(memsz),
                            static_cast<std::size_t>(filesz), static_cast<std::size_t>(off), flags});
    }
    bool executable_entry = false;
    for (const auto& segment : segments) {
        if ((segment.flags & 1u) && entry >= segment.address &&
            entry < segment.address + segment.mem_bytes && entry % 4 == 0) {
            executable_entry = true;
        }
    }
    if (!executable_entry) throw GuestFault("ELF entry does not point to executable guest memory");

    for (const auto& segment : segments) {
        std::vector<std::uint8_t> data(segment.mem_bytes, 0);
        std::copy(elf.begin() + static_cast<std::ptrdiff_t>(segment.offset),
                  elf.begin() + static_cast<std::ptrdiff_t>(segment.offset + segment.file_bytes),
                  data.begin());
        cpu.load(segment.address, data);
    }
    return LoadedGuestElf{entry, segments.size()};
}
} // namespace ordax::mobile
