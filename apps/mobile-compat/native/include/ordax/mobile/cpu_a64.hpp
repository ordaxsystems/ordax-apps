#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <stdexcept>
#include <vector>

namespace ordax::mobile {

class GuestFault final : public std::runtime_error {
public:
    explicit GuestFault(const char* message) : std::runtime_error(message) {}
};

// First instruction-level proof, not a complete ARM64 processor.
// Guest addresses are offsets into a bounded owned allocation, never host pointers.
class CpuA64 final {
public:
    explicit CpuA64(std::size_t memory_bytes);

    void load(std::uint64_t address, std::span<const std::uint8_t> bytes);
    void set_register(unsigned index, std::uint64_t value);
    [[nodiscard]] std::uint64_t reg(unsigned index) const;
    [[nodiscard]] std::size_t memory_size() const noexcept { return memory_.size(); }
    [[nodiscard]] std::uint64_t run(std::uint64_t entry, std::uint64_t max_instructions);

private:
    [[nodiscard]] std::uint64_t read64(std::uint64_t address) const;
    [[nodiscard]] std::uint32_t read32(std::uint64_t address) const;
    void write64(std::uint64_t address, std::uint64_t value);
    void store_register(unsigned index, std::uint64_t value);
    void assert_range(std::uint64_t address, std::size_t count) const;

    std::vector<std::uint8_t> memory_;
    std::array<std::uint64_t, 31> registers_{};
};
} // namespace ordax::mobile
