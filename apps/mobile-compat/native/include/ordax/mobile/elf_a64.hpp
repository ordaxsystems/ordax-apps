#pragma once

#include "ordax/mobile/cpu_a64.hpp"

#include <cstddef>
#include <cstdint>
#include <span>
#include <string>
#include <vector>

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

// ET_DYN with bounded relative RELA/RELR/APS2, at a host-chosen guest bias.
// PT_INTERP, PT_TLS, unresolved needed libraries, constructors and unknown
// relocation types fail closed; the full Android/Bionic linker is absent.
[[nodiscard]] LoadedGuestElf loadRelocatableElfA64(
    CpuA64& cpu, std::span<const std::uint8_t> elf, std::uint64_t load_bias);

// Symbol information comes exclusively from a verified provider ELF's own
// bounded DT_SYMTAB/DT_STRTAB, never user-supplied host function pointers.
struct GuestDynamicExport {
    std::string library;
    std::string symbol;
    std::uint64_t address = 0;
};
[[nodiscard]] std::vector<GuestDynamicExport> inspectGuestDynamicExports(
    std::span<const std::uint8_t> elf, std::uint64_t load_bias,
    const std::string& library);

// Only a small ET_DYN subset: explicit DT_NEEDED provider, global defined
// function via DT_HASH or bounded DT_GNU_HASH with the same dynsym parser,
// and R_AARCH64_JUMP_SLOT or GLOB_DAT. A standard DT_JMPREL table
// with DT_PLTREL=DT_RELA shares the exact same resolver (eager binding).
// Incomplete, overlapping or unsupported PLT tables fail closed.
// No libc/Bionic, versioned symbols, constructors, weak, TLS or lazy binding.
// All provider libraries must have been loaded into the SAME guest CPU.
[[nodiscard]] LoadedGuestElf loadLinkedElfA64(
    CpuA64& cpu, std::span<const std::uint8_t> elf,
    std::uint64_t load_bias, std::span<const GuestDynamicExport> providers);

} // namespace ordax::mobile
