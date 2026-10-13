#include "ordax/mobile/elf_a64.hpp"
#include "ordax/mobile/android_aps2.hpp"

#include <algorithm>
#include <array>
#include <string>
#include <string_view>
#include <unordered_set>
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
// SSOT: every relocation format emits candidate patches, but only this
// plan may authorize patch destinations. It owns global quota, W^X/write
// permissions and collision detection across RELA, RELR and Android APS2.
// The guest image is not mutated until the entire plan is accepted.
class RelocationPlan final {
public:
    RelocationPlan(const std::vector<Segment>& segments, std::size_t memory_bytes)
        : segments_(segments), memory_bytes_(memory_bytes) {}

    void append(std::span<const Relocation> candidates) {
        constexpr std::size_t kMaxRelocations = 8192;
        if (candidates.size() > kMaxRelocations - patches_.size()) {
            throw GuestFault("Combined guest relocation budget exceeded");
        }
        for (const auto& candidate : candidates) {
            if (candidate.destination % 8 != 0 ||
                candidate.destination > memory_bytes_ ||
                8 > memory_bytes_ - candidate.destination ||
                !inMapped(segments_, candidate.destination, 8, kWritable)) {
                throw GuestFault("Relocation destination is not mapped guest-writable memory");
            }
            if (!destinations_.insert(candidate.destination).second) {
                throw GuestFault("Duplicate relocation across guest ELF formats");
            }
            patches_.push_back(candidate);
        }
    }

    [[nodiscard]] const std::vector<Relocation>& patches() const { return patches_; }

private:
    const std::vector<Segment>& segments_;
    std::size_t memory_bytes_;
    std::unordered_set<std::uint64_t> destinations_;
    std::vector<Relocation> patches_;
};

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


// This parser admits only the small symbol-bearing dynamic-linking subset
// required for two *guest* ELFs. It never resolves a symbol to a host pointer.
struct DynamicSymbols {
    std::vector<std::string> needed;
    std::size_t symbol_file_offset = 0;
    std::size_t symbol_count = 0;
    std::size_t strings_file_offset = 0;
    std::size_t strings_size = 0;
    std::uint64_t rela = 0;
    std::size_t relasz = 0;
    std::size_t relacount = 0;
    bool has_rela = false;
    std::uint64_t jmprel = 0;
    std::size_t pltrelsz = 0;
    std::uint64_t pltrel = 0;
    bool has_jmprel = false, has_pltrelsz = false, has_pltrel = false;
};
std::string getBoundedString(std::span<const std::uint8_t> elf,
                             const DynamicSymbols& m, std::uint32_t index) {
    if (index >= m.strings_size) throw GuestFault("ELF dynamic string index out of range");
    const auto at = m.strings_file_offset + index;
    const auto remaining = m.strings_size - index;
    auto len = std::size_t(0);
    while (len < remaining && len <= 128 && elf[at + len] != 0) {
        const auto ch = elf[at + len];
        if (ch < 33 || ch > 126 || ch == '/' || ch == '\\') {
            throw GuestFault("Unsupported or unsafe guest symbol/library name");
        }
        ++len;
    }
    if (!len || len > 128 || len == remaining) {
        throw GuestFault("Unterminated or oversized guest symbol name");
    }
    return std::string(reinterpret_cast<const char*>(elf.data() + at), len);
}
// GNU hash tables omit the old SysV nchain field. Derive the number of
// dynamic symbols from bounded bucket/chain traversal. No host symbols or
// host ELF loader are ever involved. This runs in the SAME symbol metadata
// parser used by both ELF providers and consumers.
std::size_t countGnuHashSymbols(
    std::span<const std::uint8_t> elf, std::uint64_t address,
    const std::vector<Segment>& segments) {
    const auto head = mappedFileOffset(address, 16, segments);
    const auto buckets = get32(elf, head);
    const auto symbol_offset = get32(elf, head + 4);
    const auto bloom_words = get32(elf, head + 8);
    const auto bloom_shift = get32(elf, head + 12);
    if (!buckets || buckets > 4096 || symbol_offset == 0 ||
        symbol_offset > 4096 || bloom_words == 0 || bloom_words > 64 ||
        (bloom_words & (bloom_words - 1)) != 0 || bloom_shift >= 64) {
        throw GuestFault("Malformed or oversized ELF GNU hash header");
    }
    const std::size_t bucket_offset = 16 + 8u * bloom_words;
    const std::size_t header_bytes = bucket_offset + 4u * buckets;
    const auto array_offset = mappedFileOffset(address, header_bytes, segments);
    std::size_t count = symbol_offset;
    std::unordered_set<std::uint64_t> visited_symbols;
    visited_symbols.reserve(4096);
    // Each bucket starts a chain of 32-bit words, terminated by bit 0.
    // Cap both the number of steps and the largest referenced symtab entry.
    for (std::size_t i = 0; i < buckets; ++i) {
        const auto first = get32(elf, array_offset + bucket_offset + 4 * i);
        if (!first) continue;
        if (first < symbol_offset || first >= 4096) {
            throw GuestFault("GNU hash bucket references invalid symbol");
        }
        std::uint64_t symbol = first;
        while (true) {
            if (symbol >= 4096 || symbol < symbol_offset) {
                throw GuestFault("Unterminated or overflowing GNU hash chain");
            }
            // Symbols cannot belong to two buckets. This is both an ELF
            // structural rule and a global traversal budget: malformed
            // tables cannot force repeated quadratic chain scans.
            if (!visited_symbols.insert(symbol).second) {
                throw GuestFault("Overlapping or repeated ELF GNU hash chain");
            }
            const auto chain_delta = header_bytes + 4 * (symbol - symbol_offset);
            if (address > UINT64_MAX - chain_delta) {
                throw GuestFault("GNU hash chain address overflow");
            }
            const auto chain = mappedFileOffset(address + chain_delta, 4, segments);
            const auto word = get32(elf, chain);
            count = std::max(count, static_cast<std::size_t>(symbol) + 1);
            if (word & 1u) break;
            ++symbol;
        }
    }
    return count;
}
DynamicSymbols readDynamicSymbols(std::span<const std::uint8_t> elf,
                                   const DynamicSection& dynamic,
                                   const std::vector<Segment>& segments) {
    if (!dynamic.file_bytes || dynamic.file_bytes % 16 ||
        dynamic.file_bytes / 16 > 512) {
        throw GuestFault("Invalid dynamic section for linked ELF");
    }
    DynamicSymbols m;
    std::vector<std::uint64_t> needed_names;
    bool terminated = false;
    std::unordered_set<std::uint64_t> seen;
    std::uint64_t strtab = 0, strsz = 0, symtab = 0, syment = 0, hash = 0, gnu_hash = 0;
    std::uint64_t relaent = 0;
    bool saw_relasz = false, saw_relaent = false, saw_relacount = false;
    for (std::size_t i = 0; i < dynamic.file_bytes; i += 16) {
        const auto tag = get64(elf, dynamic.file_offset + i);
        const auto value = get64(elf, dynamic.file_offset + i + 8);
        if (tag == 0) { terminated = true; break; }
        if (tag == 1) {
            if (needed_names.size() >= 16) throw GuestFault("Too many guest DT_NEEDED libraries");
            needed_names.push_back(value);
            continue;
        }
        switch (tag) {
            case 2: case 20: case 23:
            case 4: case 5: case 6: case 7: case 8: case 9:
            case 10: case 11: case 0x6ffffff9: case 0x6ffffef5:
            case 35: case 36: case 37:
            case 0x6fffe000: case 0x6fffe001: case 0x6fffe003:
            case 0x6fffe005:
            case 0x60000011: case 0x60000012: break;
            default: throw GuestFault("Unsupported linked ELF dynamic tag");
        }
        if (!seen.insert(tag).second) throw GuestFault("Duplicate linked ELF dynamic tag");
        switch (tag) {
            case 2:
                if (value > 8192 * kRelaBytes) throw GuestFault("Unbounded PLT relocations");
                m.pltrelsz = static_cast<std::size_t>(value);
                m.has_pltrelsz = true;
                break;
            case 20: m.pltrel = value; m.has_pltrel = true; break;
            case 23: m.jmprel = value; m.has_jmprel = true; break;
            case 4: hash = value; break;
            case 0x6ffffef5: gnu_hash = value; break;
            case 5: strtab = value; break;
            case 6: symtab = value; break;
            case 7: m.rela = value; m.has_rela = true; break;
            case 8:
                if (value > 8192 * kRelaBytes) throw GuestFault("Unbounded ELF RELA");
                m.relasz = static_cast<std::size_t>(value); saw_relasz = true; break;
            case 9: relaent = value; saw_relaent = true; break;
            case 10: strsz = value; break;
            case 11: syment = value; break;
            case 0x6ffffff9:
                if (value > 8192) throw GuestFault("Unbounded DT_RELACOUNT");
                m.relacount = static_cast<std::size_t>(value);
                saw_relacount = true; break;
        }
    }
    if (!terminated || !strtab || !strsz || strsz > 65536 ||
        !symtab || syment != 24 || (!hash && !gnu_hash) ||
        (m.has_rela != saw_relasz) || (m.has_rela != saw_relaent) ||
        (saw_relaent && relaent != kRelaBytes) ||
        (saw_relacount && (!m.has_rela ||
          m.relacount > m.relasz / kRelaBytes)) ||
        m.relasz % kRelaBytes != 0 ||
        m.has_jmprel != m.has_pltrelsz ||
        m.has_jmprel != m.has_pltrel ||
        (m.has_jmprel && (!m.jmprel || m.pltrel != 7 ||
                          !m.pltrelsz || m.pltrelsz % kRelaBytes))) {
        throw GuestFault("Malformed linked ELF dynamic symbol/relocation metadata");
    }
    m.strings_size = static_cast<std::size_t>(strsz);
    m.strings_file_offset = mappedFileOffset(strtab, m.strings_size, segments);
    std::size_t sysv_count = 0, gnu_count = 0;
    if (hash) {
        const auto hash_offset = mappedFileOffset(hash, 8, segments);
        sysv_count = get32(elf, hash_offset + 4); // SysV nchain
    }
    if (gnu_hash) {
        gnu_count = countGnuHashSymbols(elf, gnu_hash, segments);
    }
    if ((hash && (!sysv_count || sysv_count > 4096)) ||
        (gnu_hash && (!gnu_count || gnu_count > 4096)) ||
        (hash && gnu_hash && sysv_count != gnu_count)) {
        throw GuestFault("ELF dynamic symbol count is invalid or ambiguous");
    }
    m.symbol_count = hash ? sysv_count : gnu_count;
    m.symbol_file_offset = mappedFileOffset(symtab, m.symbol_count * 24, segments);
    for (const auto off : needed_names) {
        if (off > 0xffffffffu) throw GuestFault("DT_NEEDED string index overflow");
        const auto name = getBoundedString(elf, m, static_cast<std::uint32_t>(off));
        if (std::find(m.needed.begin(), m.needed.end(), name) != m.needed.end()) {
            throw GuestFault("Duplicate DT_NEEDED dependency");
        }
        m.needed.push_back(name);
    }
    return m;
}
std::vector<Relocation> parseLinkedRelocations(
    std::span<const std::uint8_t> elf, const DynamicSection& dynamic,
    const std::vector<Segment>& segments, std::uint64_t bias,
    std::size_t memory_bytes, std::span<const GuestDynamicExport> providers) {
    const auto meta = readDynamicSymbols(elf, dynamic, segments);
    if (meta.needed.empty()) {
        throw GuestFault("Linked ELF requires explicit DT_NEEDED dependencies");
    }
    for (const auto& needed : meta.needed) {
        if (std::none_of(providers.begin(), providers.end(), [&](const auto& p) {
                return p.library == needed;
            })) {
            throw GuestFault("DT_NEEDED library was not explicitly loaded into guest");
        }
    }
    const auto rela_count = meta.relasz / kRelaBytes;
    const auto plt_count = meta.pltrelsz / kRelaBytes;
    if (rela_count > 8192 || plt_count > 8192 - rela_count) {
        throw GuestFault("Combined ELF RELA and PLT relocation budget exceeded");
    }
    const auto rela_start = meta.relasz
        ? mappedFileOffset(meta.rela, meta.relasz, segments) : 0;
    const auto plt_start = meta.pltrelsz
        ? mappedFileOffset(meta.jmprel, meta.pltrelsz, segments) : 0;
    if (meta.relasz && meta.pltrelsz &&
        rela_start < plt_start + meta.pltrelsz &&
        plt_start < rela_start + meta.relasz) {
        throw GuestFault("ELF DT_RELA and DT_JMPREL overlap");
    }
    std::vector<Relocation> patches;
    patches.reserve(rela_count + plt_count);
    // The SAME resolver handles regular RELA and PLT imports. The unified
    // RelocationPlan validates all destinations across these and APS2/RELR.
    const auto appendTable = [&](std::size_t source, std::size_t count, bool plt) {
        for (std::size_t i = 0; i < count; ++i) {
            const auto off = source + i * kRelaBytes;
            const auto address = get64(elf, off);
            const auto info = get64(elf, off + 8);
            const auto addend = get64(elf, off + 16);
            const auto type = static_cast<std::uint32_t>(info);
            const auto sym = static_cast<std::uint32_t>(info >> 32);
            const auto destination = checkedAddress(address, bias, 8, memory_bytes);
            std::uint64_t value = 0;
            if (!plt && type == kAarch64Relative && sym == 0) {
                value = bias + addend;
                if (!inMapped(segments, value, 1)) {
                    throw GuestFault("Linked ELF relative pointer escapes image");
                }
            } else if ((plt ? type == 1026 : (type == 1025 || type == 1026)) &&
                       sym != 0 && sym < meta.symbol_count && addend == 0) {
                const auto at = meta.symbol_file_offset + sym * 24;
                const auto symbol_name = getBoundedString(elf, meta, get32(elf, at));
                const auto shndx = get16(elf, at + 6);
                const auto binding = elf[at + 4] >> 4;
                const auto type_info = elf[at + 4] & 15;
                if (shndx != 0 || binding != 1 || type_info != 2) {
                    throw GuestFault("Unsupported or defined import in ELF relocation");
                }
                std::size_t matches = 0;
                for (const auto& provider : providers) {
                    if (provider.symbol == symbol_name &&
                        std::find(meta.needed.begin(), meta.needed.end(),
                                  provider.library) != meta.needed.end()) {
                        value = provider.address;
                        ++matches;
                    }
                }
                if (matches != 1 || !value || value >= memory_bytes) {
                    throw GuestFault("Guest symbol unresolved or ambiguously exported");
                }
            } else {
                throw GuestFault("Unsupported AArch64 guest symbol or PLT relocation");
            }
            patches.push_back({destination, value});
        }
    };
    appendTable(rela_start, rela_count, false);
    appendTable(plt_start, plt_count, true);
    return patches;
}

// RELR is a list of implicit-addend R_AARCH64_RELATIVE patches encoded as
// direct addresses and 63-address bitmaps. Both generic ELF and Android's
// older tag numbers use the same format; reject mixed tag families.
std::vector<Relocation> parseRelrRelocations(
    std::span<const std::uint8_t> elf, const DynamicSection& dynamic,
    const std::vector<Segment>& segments, std::uint64_t bias,
    std::size_t memory_bytes) {
    constexpr std::uint64_t kRelr = 36, kRelrSz = 35, kRelrEnt = 37;
    constexpr std::uint64_t kAndroidRelr = 0x6fffe000;
    constexpr std::uint64_t kAndroidRelrSz = 0x6fffe001;
    constexpr std::uint64_t kAndroidRelrEnt = 0x6fffe003;
    constexpr std::uint64_t kAndroidRelrCount = 0x6fffe005;
    bool generic = false, android = false, terminated = false;
    bool has_pointer = false, has_size = false, has_entry = false;
    std::uint64_t pointer = 0, size = 0, entry_size = 0;
    for (std::size_t i = 0; i < dynamic.file_bytes; i += 16) {
        const auto tag = get64(elf, dynamic.file_offset + i);
        const auto val = get64(elf, dynamic.file_offset + i + 8);
        if (tag == 0) { terminated = true; break; }
        const bool g = tag == kRelr || tag == kRelrSz || tag == kRelrEnt;
        const bool a = tag == kAndroidRelr ||
                       tag == kAndroidRelrSz || tag == kAndroidRelrEnt;
        // Bionic ignores DT_ANDROID_RELRCOUNT; it is only an optional hint.
        // Accept it without interpreting it as another relocation stream.
        if (tag == kAndroidRelrCount) continue;
        if (!g && !a) continue;
        generic |= g; android |= a;
        if (generic && android) throw GuestFault("Mixed generic and Android RELR tags");
        if (tag == kRelr || tag == kAndroidRelr) {
            if (has_pointer) throw GuestFault("Repeated DT_RELR");
            has_pointer = true; pointer = val;
        } else if (tag == kRelrSz || tag == kAndroidRelrSz) {
            if (has_size) throw GuestFault("Repeated DT_RELRSZ");
            has_size = true; size = val;
        } else {
            if (has_entry) throw GuestFault("Repeated DT_RELRENT");
            has_entry = true; entry_size = val;
        }
    }
    if (!terminated) throw GuestFault("Unterminated RELR dynamic section");
    if (!has_pointer && !has_size && !has_entry) return {};
    if (!has_pointer || !has_size || !has_entry || entry_size != 8 ||
        !size || size % 8 || size > 16384) {
        throw GuestFault("Malformed or oversized RELR metadata");
    }
    const auto input = mappedFileOffset(pointer, static_cast<std::size_t>(size), segments);
    std::vector<Relocation> result;
    result.reserve(static_cast<std::size_t>(size / 8));
    std::uint64_t next = 0;
    bool have_base = false;
    const auto append = [&](std::uint64_t virtual_address) {
        if (virtual_address % 8) throw GuestFault("Unaligned RELR target");
        const auto destination = checkedAddress(virtual_address, bias, 8, memory_bytes);
        // The addend is the *original* 64-bit word in the image, not a value
        // from a previously patched guest mapping. A zero-filled BSS target
        // has zero addend; partially file-backed words are refused.
        std::uint64_t addend = 0;
        bool found = false;
        for (const auto& segment : segments) {
            if (virtual_address < segment.vaddr ||
                virtual_address - segment.vaddr > segment.mem_bytes ||
                8 > segment.mem_bytes - (virtual_address - segment.vaddr)) continue;
            const auto relative = virtual_address - segment.vaddr;
            if (relative <= segment.file_bytes && 8 <= segment.file_bytes - relative) {
                addend = get64(elf, segment.file_offset + static_cast<std::size_t>(relative));
            } else if (relative < segment.file_bytes) {
                throw GuestFault("RELR addend overlaps file data and BSS");
            }
            found = true;
            break;
        }
        if (!found || addend > UINT64_MAX - bias) {
            throw GuestFault("Invalid RELR implicit addend");
        }
        const auto value = addend + bias;
        if (!inMapped(segments, value, 1)) {
            throw GuestFault("RELR implicit pointer escapes guest image");
        }
        if (result.size() >= 8192) throw GuestFault("Excessive decoded RELR patches");
        result.push_back({destination, value});
    };
    for (std::size_t i = 0; i < size / 8; ++i) {
        const auto word = get64(elf, input + i * 8);
        if ((word & 1) == 0) {
            if (have_base && word < next) {
                throw GuestFault("RELR absolute entries are not monotonic");
            }
            append(word);
            if (word > UINT64_MAX - 8) throw GuestFault("RELR address overflow");
            next = word + 8;
            have_base = true;
        } else {
            if (!have_base || next > UINT64_MAX - 63 * 8) {
                throw GuestFault("RELR bitmap without valid address anchor");
            }
            for (unsigned bit = 1; bit < 64; ++bit) {
                if ((word >> bit) & 1) append(next + (bit - 1) * 8);
            }
            next += 63 * 8;
        }
    }
    return result;
}
// APS2 is not RELR. It encodes full RELA records using signed LEB128.
// The decoder is pure; relocation permissions and symbol policy stay here.
std::vector<Relocation> parseAndroidAps2Relocations(
    std::span<const std::uint8_t> elf, const DynamicSection& dynamic,
    const std::vector<Segment>& segments, std::uint64_t bias,
    std::size_t memory_bytes) {
    constexpr std::uint64_t kPackedRela = 0x60000011;
    constexpr std::uint64_t kPackedRelaSz = 0x60000012;
    bool found_pointer = false, found_size = false;
    std::uint64_t pointer = 0, size = 0;
    bool terminated = false;
    for (std::size_t i = 0; i < dynamic.file_bytes; i += 16) {
        const auto tag = get64(elf, dynamic.file_offset + i);
        const auto value = get64(elf, dynamic.file_offset + i + 8);
        if (!tag) { terminated = true; break; }
        if (tag == kPackedRela) {
            if (found_pointer) throw GuestFault("Duplicate DT_ANDROID_RELA");
            found_pointer = true; pointer = value;
        } else if (tag == kPackedRelaSz) {
            if (found_size) throw GuestFault("Duplicate DT_ANDROID_RELASZ");
            found_size = true; size = value;
        }
    }
    if (!terminated) throw GuestFault("Unterminated APS2 dynamic table");
    if (!found_pointer && !found_size) return {};
    if (!found_pointer || !found_size || size < 6 || size > 65536) {
        throw GuestFault("Invalid Android packed RELA metadata");
    }
    const auto pos = mappedFileOffset(pointer, static_cast<std::size_t>(size), segments);
    const auto records = decodeAndroidAps2Rela(
        elf.subspan(pos, static_cast<std::size_t>(size)));
    std::vector<Relocation> patches;
    patches.reserve(records.size());
    for (const auto& record : records) {
        const auto sym = static_cast<std::uint32_t>(record.info >> 32);
        const auto type = static_cast<std::uint32_t>(record.info);
        // No silent host symbol resolution or JNI addresses. Additional
        // packed external-symbol relocation types need a real Bionic ABI.
        if (sym || type != kAarch64Relative) {
            throw GuestFault("Unresolved or unsupported APS2 AArch64 relocation");
        }
        const auto destination = checkedAddress(
            record.offset, bias, 8, memory_bytes);
        const auto value = bias + static_cast<std::uint64_t>(record.addend);
        if (!inMapped(segments, value, 1)) {
            throw GuestFault("APS2 relative addend points outside guest image");
        }
        patches.push_back({destination, value});
    }
    return patches;
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
    bool has_symbol_metadata = false;
    bool has_rela = false, has_relasz = false, has_relaent = false;
    bool has_relacount = false;
    std::uint64_t rela = 0, relasz = 0, relaent = 0, relacount = 0;
    for (std::size_t i = 0; i < dynamic.file_bytes; i += 16) {
        const auto offset = dynamic.file_offset + i;
        const auto tag = get64(elf, offset);
        const auto value = get64(elf, offset + 8);
        if (tag == 0) { terminated = true; break; }
        switch (tag) {
            case 35: case 36: case 37:
            case 0x6fffe000: case 0x6fffe001: case 0x6fffe003:
            case 0x6fffe005:
                break; // RELR parsed by one shared bounded decoder
            case 0x60000011: case 0x60000012:
                break; // Android APS2 stream checked by the shared ELF linker
            case 4: case 5: case 6: case 10: case 11:
            case 0x6ffffef5:
                // Self-contained ET_DYN providers may publish dynamic symbols,
                // but must never load or resolve dependencies implicitly.
                has_symbol_metadata = true; break;
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
    if (has_symbol_metadata) {
        const auto info = readDynamicSymbols(elf, dynamic, segments);
        if (!info.needed.empty()) throw GuestFault("Provider ELF has unsupported DT_NEEDED");
    }
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
        // ELF64 r_addend is signed. Two's complement arithmetic here is
        // intentional; validate the resulting guest pointer before using it.
        const auto value = bias + addend;
        if (!inMapped(segments, value, 1)) {
            throw GuestFault("Relative relocation value escapes the mapped image");
        }
        patches.push_back({destination, value});
    }
    return patches;
}
LoadedGuestElf loadElf(CpuA64& cpu, std::span<const std::uint8_t> elf,
                       std::uint64_t bias, std::uint16_t expected_type,
                       std::span<const GuestDynamicExport> providers = {}) {
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

    RelocationPlan relocation_plan(segments, cpu.memory_size());
    if (!dynamic_sections.empty()) {
        const auto& dynamic = dynamic_sections.front();
        if (mappedFileOffset(dynamic.vaddr, dynamic.file_bytes, segments) != dynamic.file_offset ||
            !inMapped(segments, checkedAddress(dynamic.vaddr, bias, dynamic.file_bytes, cpu.memory_size()),
                      dynamic.file_bytes)) {
            throw GuestFault("PT_DYNAMIC is not backed by the mapped guest image");
        }
        if (providers.empty()) {
            relocation_plan.append(parseRelativeRelocations(
                elf, dynamic, segments, bias, cpu.memory_size()));
        } else {
            relocation_plan.append(parseLinkedRelocations(
                elf, dynamic, segments, bias, cpu.memory_size(), providers));
        }
        relocation_plan.append(parseAndroidAps2Relocations(
            elf, dynamic, segments, bias, cpu.memory_size()));
        relocation_plan.append(parseRelrRelocations(
            elf, dynamic, segments, bias, cpu.memory_size()));
    }
    const auto& patches = relocation_plan.patches();

    // Validate *all* mappings against previously loaded ELF objects BEFORE
    // modifying guest memory. A second library may not overwrite a provider.
    std::vector<GuestRegion> protections;
    protections.reserve(segments.size());
    for (const auto& segment : segments) {
        protections.push_back({segment.address, segment.mem_bytes,
                               static_cast<std::uint8_t>(segment.flags & 7u)});
    }
    cpu.verify_new_guest_regions(protections);

    // No guest mutation until every header, dependency, relocation and entry
    // is validated. Host addresses are never used as guest symbols.
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

std::vector<GuestDynamicExport> inspectGuestDynamicExports(
    std::span<const std::uint8_t> elf, std::uint64_t bias,
    const std::string& library) {
    if (library.empty() || library.size() > 128 ||
        library.find_first_of("/\\") != std::string::npos ||
        elf.size() < kHeaderBytes || elf[0] != 0x7f || elf[1] != 'E' ||
        elf[2] != 'L' || elf[3] != 'F' || elf[4] != 2 || elf[5] != 1 ||
        get16(elf, 16) != kElfShared || get16(elf, 18) != kArm64Machine ||
        get16(elf, 54) != kProgramBytes || bias % 4096) {
        throw GuestFault("Invalid ELF image or library name for guest exports");
    }
    const auto phoff = get64(elf, 32);
    const auto phnum = static_cast<std::size_t>(get16(elf, 56));
    if (!phnum || phnum > 128 || phoff > elf.size() ||
        phnum * kProgramBytes > elf.size() - phoff) {
        throw GuestFault("Guest export program headers are invalid");
    }
    std::vector<Segment> segments;
    std::vector<DynamicSection> dynamic;
    for (std::size_t i = 0; i < phnum; ++i) {
        const auto p = static_cast<std::size_t>(phoff) + i * kProgramBytes;
        const auto tag = get32(elf, p);
        const auto flags = get32(elf, p + 4);
        const auto off = get64(elf, p + 8);
        const auto vaddr = get64(elf, p + 16);
        const auto filesz = get64(elf, p + 32);
        const auto memsz = get64(elf, p + 40);
        if (tag != kLoad && tag != kDynamic) continue;
        if (off > elf.size() || filesz > elf.size() - off) {
            throw GuestFault("Guest symbol file segment outside ELF");
        }
        if (tag == kDynamic) {
            if (dynamic.size() || !filesz || filesz > 8192) {
                throw GuestFault("Missing or repeated guest symbol dynamic section");
            }
            dynamic.push_back({static_cast<std::size_t>(off),
                               static_cast<std::size_t>(filesz), vaddr});
        } else {
            if (segments.size() >= 64 || !memsz || memsz < filesz ||
                memsz > 64u * 1024u * 1024u ||
                (flags & (kWritable | kExecutable)) == (kWritable | kExecutable) ||
                vaddr > UINT64_MAX - bias) {
                throw GuestFault("Invalid guest symbol PT_LOAD");
            }
            const auto address = vaddr + bias;
            for (const auto& other : segments) {
                if (address < other.address + other.mem_bytes &&
                    other.address < address + memsz) {
                    throw GuestFault("Overlapping guest export segments");
                }
            }
            segments.push_back({address, vaddr, static_cast<std::size_t>(memsz),
                                static_cast<std::size_t>(filesz),
                                static_cast<std::size_t>(off), flags});
        }
    }
    if (dynamic.size() != 1 ||
        mappedFileOffset(dynamic[0].vaddr, dynamic[0].file_bytes, segments) !=
            dynamic[0].file_offset) {
        throw GuestFault("Unmapped guest symbol dynamic section");
    }
    const auto meta = readDynamicSymbols(elf, dynamic[0], segments);
    if (!meta.needed.empty() || meta.has_rela) {
        throw GuestFault("Guest provider must be self-contained for this linker subset");
    }
    std::vector<GuestDynamicExport> exports;
    for (std::size_t i = 1; i < meta.symbol_count; ++i) {
        const auto at = meta.symbol_file_offset + i * 24;
        const auto symbol_type = elf[at + 4] & 15;
        const auto binding = elf[at + 4] >> 4;
        if (get16(elf, at + 6) == 0 || binding != 1 || symbol_type != 2) continue;
        const auto name = getBoundedString(elf, meta, get32(elf, at));
        const auto symaddr = get64(elf, at + 8);
        if (symaddr > UINT64_MAX - bias ||
            !inMapped(segments, symaddr + bias, 4, kExecutable)) {
            throw GuestFault("Exported guest function outside executable segment");
        }
        if (std::any_of(exports.begin(), exports.end(), [&](const auto& x) {
                return x.symbol == name;
            })) throw GuestFault("Duplicate ELF export name");
        exports.push_back({library, name, symaddr + bias});
    }
    if (exports.empty()) throw GuestFault("No supported global guest function exports");
    return exports;
}
LoadedGuestElf loadLinkedElfA64(
    CpuA64& cpu, std::span<const std::uint8_t> elf,
    std::uint64_t bias, std::span<const GuestDynamicExport> providers) {
    if (providers.empty()) throw GuestFault("No verified guest providers supplied");
    // A dependency's code page must already be mapped and executable. This
    // prevents importing fabricated numeric pointers passed by host code.
    for (const auto& provider : providers) {
        if (provider.library.empty() || provider.symbol.empty() ||
            provider.address % 4) {
            throw GuestFault("Invalid guest provider export");
        }
        cpu.require_guest_access(provider.address, 4, 1);
    }
    return loadElf(cpu, elf, bias, kElfShared, providers);
}

} // namespace ordax::mobile
