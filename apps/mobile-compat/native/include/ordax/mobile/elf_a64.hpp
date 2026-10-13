#pragma once

#include "ordax/mobile/cpu_a64.hpp"

#include <cstddef>
#include <cstdint>
#include <span>

namespace ordax::mobile {

struct LoadedGuestElf {
    std::uint64_t entry = 0;
    std::size_t load_segments = 0;
    std::uint64_t load_bias = 0;
    std::size_t relative_relocations = 0;
    bool has_entry = false;
};

// The same validated loader handles ET_EXEC and the supported ET_DYN subset.
// Executable guest entry and all PT_LOAD/RELA bounds are checked before mapping.
[[nodiscard]] LoadedGuestElf loadStaticElfA64(CpuA64& cpu, std::span<const std::uint8_t> elf);

// ET_DYN with DT_RELA + R_AARCH64_RELATIVE only, at a host-chosen guest bias.
// PT_INTERP, PT_TLS, needed libraries, symbol resolution and other relocations
// fail closed until the Android dynamic linker and Bionic are implemented.
[[nodiscard]] LoadedGuestElf loadRelocatableElfA64(
    CpuA64& cpu, std::span<const std::uint8_t> elf, std::uint64_t load_bias);

} // namespace ordax::mobile
