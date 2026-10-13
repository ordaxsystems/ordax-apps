cmake_minimum_required(VERSION 3.20)
project(ordax_mobile_guest VERSION 0.1.0 LANGUAGES CXX)

add_library(ordax_mobile_guest STATIC src/cpu_a64.cpp src/elf_a64.cpp)
target_include_directories(ordax_mobile_guest PUBLIC include)
target_compile_features(ordax_mobile_guest PUBLIC cxx_std_20)
if(MSVC)
  target_compile_options(ordax_mobile_guest PRIVATE /W4 /permissive-)
else()
  target_compile_options(ordax_mobile_guest PRIVATE -Wall -Wextra -Wpedantic)
endif()

enable_testing()
add_executable(ordax_mobile_guest_tests tests/cpu_a64.test.cpp)
target_link_libraries(ordax_mobile_guest_tests PRIVATE ordax_mobile_guest)
add_test(NAME mobile-a64-instruction-proof COMMAND ordax_mobile_guest_tests)

add_executable(ordax_mobile_dynamic_elf_tests tests/elf_dynamic.test.cpp)
target_link_libraries(ordax_mobile_dynamic_elf_tests PRIVATE ordax_mobile_guest)
add_test(NAME mobile-a64-dynamic-elf-relocation-proof COMMAND ordax_mobile_dynamic_elf_tests)

add_executable(ordax-mobile-guest src/guest_cli.cpp)
target_link_libraries(ordax-mobile-guest PRIVATE ordax_mobile_guest)
add_test(NAME mobile-guest-cli-help COMMAND ordax-mobile-guest)
set_tests_properties(mobile-guest-cli-help PROPERTIES WILL_FAIL TRUE)

# Exercise the actual .elf file path through the native host, not just memory.
add_test(NAME mobile-native-fixture
         COMMAND ordax_mobile_dynamic_elf_tests --emit-fixture
                 "${CMAKE_CURRENT_BINARY_DIR}/mobile-guest-fixture.elf")
set_tests_properties(mobile-native-fixture PROPERTIES FIXTURES_SETUP mobile-guest-fixture)
add_test(NAME mobile-native-entry-file-proof
         COMMAND ordax-mobile-guest run-elf
                 "${CMAKE_CURRENT_BINARY_DIR}/mobile-guest-fixture.elf")
set_tests_properties(mobile-native-entry-file-proof PROPERTIES
    FIXTURES_REQUIRED mobile-guest-fixture
    PASS_REGULAR_EXPRESSION "guestReturn.*12288")
