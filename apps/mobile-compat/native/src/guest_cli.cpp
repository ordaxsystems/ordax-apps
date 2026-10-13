// Developer host for the bounded guest CPU, not an Android app launcher.
#include "ordax/mobile/elf_a64.hpp"
#include "ordax/mobile/jni_guest.hpp"

#include <algorithm>
#include <bit>
#include <charconv>
#include <cstdint>
#include <string>
#include <system_error>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <limits>
#include <vector>

int main(int argc, char** argv) {
    const bool old_mode = argc == 3 && std::string(argv[1]) == "run-elf";
    const bool call_mode = argc >= 3 && argc <= 8 &&
                           std::string(argv[1]) == "invoke-i32-elf";
    const bool jni_mode = argc >= 3 && argc <= 8 &&
                           std::string(argv[1]) == "invoke-jni-i32-elf";
    const bool jni_array_mode = argc == 4 &&
                                std::string(argv[1]) == "invoke-jni-int-array-elf";
    if (!old_mode && !call_mode && !jni_mode && !jni_array_mode) {
        std::cerr << "usage: ordax-mobile-guest run-elf <elf>\n"
                  << "   or: ordax-mobile-guest invoke-i32-elf <elf> [int32 x0..x4]\n"
                  << "   or: ordax-mobile-guest invoke-jni-i32-elf <elf> [int32 x2..x6]\n"
                  << "   or: ordax-mobile-guest invoke-jni-int-array-elf <elf> <array-snapshot>\n";
        return 2;
    }
    std::vector<std::int32_t> arguments;
    if (call_mode || jni_mode) {
        for (int i = 3; i < argc; ++i) {
            const std::string arg(argv[i]);
            std::int32_t value = 0;
            if (arg.empty()) return 2;
            const auto parsed = std::from_chars(arg.data(), arg.data() + arg.size(), value);
            if (parsed.ec != std::errc{} || parsed.ptr != arg.data() + arg.size()) {
                std::cerr << "Invalid int32 argument\n";
                return 2;
            }
            arguments.push_back(value);
        }
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
        // Only typed integers cross the boundary: no guest object references,
        // JNI environment, raw pointers or untrusted callback addresses.
        ordax::mobile::JniGuestEnvironment jni;
        if (jni_mode || jni_array_mode) {
            jni.install(cpu);
            cpu.set_register(0, ordax::mobile::JniGuestEnvironment::kEnvAddress);
            cpu.set_register(1, ordax::mobile::JniGuestEnvironment::kClassHandle);
        }
        std::uint64_t arrayHandle = 0;
        if (jni_array_mode) {
            const std::filesystem::path arrayPath(argv[3]);
            const auto snapshotSize = std::filesystem::file_size(arrayPath);
            if (snapshotSize < 12 || snapshotSize > 12 + 1024 * 4) {
                throw ordax::mobile::GuestFault("Invalid bounded JNI array snapshot length");
            }
            std::ifstream input(arrayPath, std::ios::binary);
            std::vector<std::uint8_t> snapshot(static_cast<std::size_t>(snapshotSize));
            if (!input.read(reinterpret_cast<char*>(snapshot.data()),
                            static_cast<std::streamsize>(snapshot.size()))) {
                throw ordax::mobile::GuestFault("Truncated JNI array snapshot");
            }
            constexpr char kMagic[] = "ODXA64I1";
            if (!std::equal(snapshot.begin(), snapshot.begin() + 8, kMagic)) {
                throw ordax::mobile::GuestFault("Invalid JNI array snapshot schema");
            }
            std::uint32_t count = 0;
            for (unsigned j = 0; j < 4; ++j) count |= std::uint32_t(snapshot[8 + j]) << (8 * j);
            if (count > 1024 || snapshot.size() != 12u + std::size_t(count) * 4u) {
                throw ordax::mobile::GuestFault("JNI array snapshot count mismatch");
            }
            std::vector<std::int32_t> items(count);
            for (std::size_t j = 0; j < count; ++j) {
                std::uint32_t word = 0;
                for (unsigned k = 0; k < 4; ++k) {
                    word |= std::uint32_t(snapshot[12 + j * 4 + k]) << (8 * k);
                }
                items[j] = std::bit_cast<std::int32_t>(word);
            }
            arrayHandle = jni.importIntArray(items);
            cpu.set_register(2, arrayHandle);
        }
        for (std::size_t i = 0; i < arguments.size(); ++i) {
            cpu.set_register(static_cast<unsigned>(i + (jni_mode ? 2 : 0)),
                             static_cast<std::uint64_t>(static_cast<std::int64_t>(arguments[i])));
        }
        // Instruction and memory budgets are mandatory and cannot be removed
        // through command-line arguments.
        const auto result = cpu.run(image.entry, 100000);
        if (jni_array_mode) {
            const auto value = std::bit_cast<std::int32_t>(
                static_cast<std::uint32_t>(result));
            const auto& items = jni.exportIntArray(arrayHandle);
            std::cout << "{\"schema\":\"ordax.mobile-compat.jni-int-array-call/1\","
                      << "\"value\":" << value << ",\"array\":[";
            for (std::size_t i = 0; i < items.size(); ++i) {
                if (i) std::cout << ',';
                std::cout << items[i];
            }
            std::cout << "]}\n";
            return 0;
        }
        if (call_mode || jni_mode) {
            const auto value = std::bit_cast<std::int32_t>(
                static_cast<std::uint32_t>(result));
            std::cout << "{\"schema\":\""
                      << (jni_mode ? "ordax.mobile-compat.jni-static-i32-call/1"
                                   : "ordax.mobile-compat.i32-guest-call/1")
                      << "\",\"value\":" << value << "}\n";
            return 0;
        }
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
