#include "ordax/mobile/android_aps2.hpp"

#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>
#include <vector>

using ordax::mobile::AndroidPackedRela;
using ordax::mobile::GuestFault;
using ordax::mobile::decodeAndroidAps2Rela;

namespace {
void pushSigned(std::vector<std::uint8_t>& bytes, std::int64_t value) {
    bool more = true;
    while (more) {
        auto b = static_cast<std::uint8_t>(value & 0x7f);
        value >>= 7;
        const auto sign = (b & 0x40) != 0;
        more = !((value == 0 && !sign) || (value == -1 && sign));
        if (more) b |= 0x80;
        bytes.push_back(b);
    }
}
std::vector<std::uint8_t> stream(std::initializer_list<std::int64_t> values) {
    std::vector<std::uint8_t> data = {'A','P','S','2'};
    for (auto value : values) pushSigned(data, value);
    return data;
}
template<class Fn> void reject(Fn&& fn) {
    bool failed = false;
    try { fn(); } catch (const GuestFault&) { failed = true; }
    assert(failed);
}
}

int main() {
    // Two grouped entries, one per-relocation addend, and one group without
    // addend. Confirm cumulative deltas agree with Android APS2 semantics.
    {
        const auto bytes = stream({
            4, 0x2ff8,
            2, 15, 8, 1027, 0x1000,
            1, 8, 8, 1027, -0x100,
            1, 0, 8, 1027
        });
        const auto out = decodeAndroidAps2Rela(bytes);
        assert(out.size() == 4);
        assert(out[0].offset == 0x3000 && out[0].info == 1027 &&
               out[0].addend == 0x1000);
        assert(out[1].offset == 0x3008 && out[1].addend == 0x1000);
        assert(out[2].offset == 0x3010 && out[2].addend == 0xf00);
        assert(out[3].offset == 0x3018 && out[3].addend == 0);
    }
    {
        // Two groups use explicit per-relocation signed addend deltas,
        // including a negative delta in the second relocation.
        const auto bytes = stream({
            3, 0x2ff8,
            1, 11, 8, 1027, 0x1000,
            2, 11, 8, 1027, 0, -16
        });
        const auto result = decodeAndroidAps2Rela(bytes);
        assert(result.size() == 3);
        assert(result[0].offset == 0x3000 && result[0].addend == 0x1000);
        assert(result[1].offset == 0x3008 && result[1].addend == 0x1000);
        assert(result[2].offset == 0x3010 && result[2].addend == 0xff0);
    }
    {
        auto padded = stream({1, 0x2ff8, 1, 15, 8, 1027, 0x1000});
        padded.push_back(0);
        padded.push_back(0);
        assert(decodeAndroidAps2Rela(padded).size() == 1);
    }
    std::size_t corpus_case = 0;
    for (const auto& invalid : {
        stream({0, 0}),
        stream({8193, 0}),
        stream({1, -1}),
        stream({1, 0, 0, 0}),
        stream({1, 0, 2, 15, 8, 1027, 0x1000}),
        stream({1, 0, 1, 4}),
        stream({1, 0, 1, 16}),
        stream({1, 0, 1, 15, -8, 1027, 0x1000}),
        stream({2, 0x7fffffffffffffffLL, 2, 15,
                0x7fffffffffffffffLL, 1027, 0x1000})
    }) {
        bool rejected = false;
        try { (void)decodeAndroidAps2Rela(invalid); }
        catch (const GuestFault&) { rejected = true; }
        if (!rejected) {
            std::cerr << "APS2 malformed corpus unexpectedly accepted case #"
                      << corpus_case << '\n';
        }
        assert(rejected);
        ++corpus_case;
    }
    {
        auto bad = stream({1, 0, 1, 15, 8, 1027, 0x1000});
        bad[0] = 'X';
        reject([&] { (void)decodeAndroidAps2Rela(bad); });
    }
    {
        auto bad = stream({1, 0, 1, 15, 8, 1027, 0x1000});
        bad.push_back(1); // trailing valid-looking metadata is forbidden
        reject([&] { (void)decodeAndroidAps2Rela(bad); });
        bad.pop_back();
        bad.pop_back(); // truncated last signed addend
        reject([&] { (void)decodeAndroidAps2Rela(bad); });
    }
    {
        const std::vector<std::uint8_t> noncanonical =
            {'A', 'P', 'S', '2', 0x81, 0}; // overlong signed total
        reject([&] { (void)decodeAndroidAps2Rela(noncanonical); });
    }
    {
        const auto overflow = stream({
            2, 0, 1, 11, 8, 1027,
            std::numeric_limits<std::int64_t>::max(),
            1, 11, 8, 1027, 1
        });
        reject([&] { (void)decodeAndroidAps2Rela(overflow); });
    }
    std::cout << "APS2 grouped signed delta decoder and fail-closed parsing passed\n";
}
