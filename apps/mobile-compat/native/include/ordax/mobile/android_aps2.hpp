#pragma once

#include "ordax/mobile/cpu_a64.hpp"

#include <cstdint>
#include <span>
#include <vector>

namespace ordax::mobile {

// Android APS2: bounded, host-pointer-free decoder for ARM64 RELA records.
// Decode only; the existing ELF loader remains the single authority for
// symbol resolution, writable mappings and relocation application.
struct AndroidPackedRela {
    std::uint64_t offset = 0;
    std::uint64_t info = 0;
    std::int64_t addend = 0;
};

[[nodiscard]] std::vector<AndroidPackedRela> decodeAndroidAps2Rela(
    std::span<const std::uint8_t> stream);
} // namespace ordax::mobile
