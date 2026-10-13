#include "ordax/mobile/android_aps2.hpp"

#include <bit>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace ordax::mobile {
namespace {
constexpr std::size_t kMaxRelocations = 8192;
constexpr std::size_t kMaxBytes = 65536;
constexpr std::uint64_t kInfoGrouped = 1;
constexpr std::uint64_t kOffsetGrouped = 2;
constexpr std::uint64_t kAddendGrouped = 4;
constexpr std::uint64_t kHasAddend = 8;

class SignedLebReader {
public:
    explicit SignedLebReader(std::span<const std::uint8_t> data) : data_(data) {}

    std::int64_t read() {
        std::uint64_t bits = 0;
        std::uint8_t previous = 0;
        for (unsigned i = 0; i < 10; ++i) {
            if (position_ == data_.size()) throw GuestFault("Truncated APS2 SLEB128");
            const auto b = data_[position_++];
            const auto part = static_cast<std::uint64_t>(b & 0x7f);
            if (i == 9) {
                if ((b & 0x80) || (part != 0 && part != 0x7f)) {
                    throw GuestFault("APS2 SLEB128 overflows signed 64-bit");
                }
                bits |= (part & 1u) << 63;
            } else {
                bits |= part << (7 * i);
            }
            if ((b & 0x80) == 0) {
                if (i && ((part == 0 && !(previous & 0x40)) ||
                          (part == 0x7f && (previous & 0x40)))) {
                    throw GuestFault("APS2 overlong signed LEB128");
                }
                if (i < 9 && (b & 0x40)) {
                    bits |= (~std::uint64_t(0)) << (7 * (i + 1));
                }
                return std::bit_cast<std::int64_t>(bits);
            }
            previous = b;
        }
        throw GuestFault("APS2 unterminated SLEB128");
    }

    std::uint64_t nonnegative() {
        const auto n = read();
        if (n < 0) throw GuestFault("Negative APS2 size, flag, info or offset delta");
        return static_cast<std::uint64_t>(n);
    }

    bool zeroPadded() const {
        for (std::size_t i = position_; i < data_.size(); ++i) {
            if (data_[i] != 0) return false;
        }
        return true;
    }

private:
    std::span<const std::uint8_t> data_;
    std::size_t position_ = 0;
};

std::uint64_t checkedUnsigned(std::uint64_t a, std::uint64_t b) {
    if (b > std::numeric_limits<std::uint64_t>::max() - a) {
        throw GuestFault("APS2 unsigned delta overflows");
    }
    return a + b;
}
std::int64_t checkedSigned(std::int64_t a, std::int64_t b) {
    if ((b > 0 && a > std::numeric_limits<std::int64_t>::max() - b) ||
        (b < 0 && a < std::numeric_limits<std::int64_t>::min() - b)) {
        throw GuestFault("APS2 signed addend delta overflows");
    }
    return a + b;
}
} // namespace

std::vector<AndroidPackedRela> decodeAndroidAps2Rela(
    std::span<const std::uint8_t> stream) {
    if (stream.size() < 6 || stream.size() > kMaxBytes ||
        stream[0] != 'A' || stream[1] != 'P' ||
        stream[2] != 'S' || stream[3] != '2') {
        throw GuestFault("Invalid or unbounded Android APS2 relocation stream");
    }
    SignedLebReader input(stream.subspan(4));
    const auto total = input.nonnegative();
    if (total == 0 || total > kMaxRelocations) {
        throw GuestFault("APS2 relocation count exceeds budget");
    }
    auto offset = input.nonnegative();
    std::uint64_t info = 0;
    std::int64_t addend = 0;
    std::vector<AndroidPackedRela> result;
    result.reserve(static_cast<std::size_t>(total));

    while (result.size() < total) {
        const auto group_count = input.nonnegative();
        const auto flags = input.nonnegative();
        if (group_count == 0 || group_count > total - result.size() ||
            (flags & ~std::uint64_t(15)) != 0 ||
            ((flags & kAddendGrouped) && !(flags & kHasAddend))) {
            throw GuestFault("Invalid APS2 relocation group size or flags");
        }
        std::uint64_t group_delta = 0;
        if (flags & kOffsetGrouped) group_delta = input.nonnegative();
        if (flags & kInfoGrouped) info = input.nonnegative();

        if ((flags & kHasAddend) == 0) addend = 0;
        else if (flags & kAddendGrouped) addend = checkedSigned(addend, input.read());

        for (std::uint64_t i = 0; i < group_count; ++i) {
            const auto delta = (flags & kOffsetGrouped)
                ? group_delta : input.nonnegative();
            offset = checkedUnsigned(offset, delta);
            if (!(flags & kInfoGrouped)) info = input.nonnegative();
            if ((flags & kHasAddend) && !(flags & kAddendGrouped)) {
                addend = checkedSigned(addend, input.read());
            }
            result.push_back({offset, info, addend});
        }
    }
    // Older tools may pad packed streams to a word boundary, but data after
    // the declared records is never allowed to introduce hidden operations.
    if (!input.zeroPadded()) {
        throw GuestFault("APS2 trailing non-padding relocation data");
    }
    return result;
}
} // namespace ordax::mobile
