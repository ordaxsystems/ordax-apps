#pragma once

#include "ordax/mobile/cpu_a64.hpp"

#include <cstddef>
#include <cstdint>
#include <span>

namespace ordax::mobile {

struct LoadedGuestElf {
    std::uint64_t entry = 0;
    std::size_t load_segments = 0;
};

// Maps bounded, static AArch64 ELF64 PT_LOAD segments to guest-owned memory.
// Deliberately rejects ET_DYN, relocations and interpreter dependencies.
// This is a loader primitive, not the Android dynamic linker.
[[nodiscard]] LoadedGuestElf loadStaticElfA64(CpuA64& cpu, std::span<const std::uint8_t> elf);

} // namespace ordax::mobile
