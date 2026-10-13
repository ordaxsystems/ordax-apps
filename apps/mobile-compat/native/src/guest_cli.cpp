// Developer host for the bounded guest CPU, not an Android app launcher.
#include "ordax/mobile/elf_a64.hpp"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <limits>
#include <vector>

int main(int argc, char** argv) {
    if (argc != 3 || std::string(argv[1]) != "run-elf") {
        std::cerr << "usage: ordax-mobile-guest run-elf <static-aarch64-elf|relative-only-et-dyn>\n";
        return 2;
    }
    try {
        const std::filesystem::path file(argv[2]);
        constexpr std::uintmax_t max_input = 16u * 1024u * 1024u;
        const auto size = std::filesystem::file_size(file);
        if (size < 64 || size > max_input) {
            std::cerr << "ELF file size outside developer runner limits\n";
            return 3;
        }
        std::ifstream stream(file, std::ios::binary);
        if (!stream.is_open()) {
            std::cerr << "Cannot open ELF input\n";
            return 3;
        }
        std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
        if (!stream.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(size))) {
            std::cerr << "Incomplete ELF input\n";
            return 3;
        }
        ordax::mobile::CpuA64 cpu(64u * 1024u * 1024u);
        const std::uint16_t kind = std::uint16_t(bytes[16]) |
                                  (std::uint16_t(bytes[17]) << 8);
        ordax::mobile::LoadedGuestElf image;
        if (kind == 2) {
            image = ordax::mobile::loadStaticElfA64(cpu, bytes);
        } else if (kind == 3) {
            image = ordax::mobile::loadRelocatableElfA64(cpu, bytes, 0x400000);
        } else {
            std::cerr << "Unsupported ELF kind\n";
            return 3;
        }
        if (!image.has_entry) {
            std::cerr << "Shared library has no guest entrypoint; JNI/Android linking not available\n";
            return 4;
        }
        // Instruction and memory budgets are mandatory and cannot be removed
        // through command-line arguments.
        const auto result = cpu.run(image.entry, 100000);
        std::cout << "{\n"
                  << "  \"schema\": \"ordax.mobile-compat.native-guest-result/1\",\n"
                  << "  \"execution\": \"bounded-instruction-subset\",\n"
                  << "  \"guestReturn\": " << result << ",\n"
                  << "  \"relativeRelocations\": " << image.relative_relocations << "\n"
                  << "}\n";
        return 0;
    } catch (const ordax::mobile::GuestFault& error) {
        std::cerr << "Guest execution refused: " << error.what() << "\n";
        return 4;
    } catch (const std::exception& error) {
        std::cerr << "Guest input failed: " << error.what() << "\n";
        return 3;
    }
}
