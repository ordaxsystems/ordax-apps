cmake_minimum_required(VERSION 3.20)
project(ordax_mobile_guest VERSION 0.1.0 LANGUAGES CXX)

add_library(ordax_mobile_guest STATIC src/cpu_a64.cpp src/elf_a64.cpp src/jni_guest.cpp)
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
    PASS_REGULAR_EXPRESSION "guestReturn.*4198400")

# Integration: verified DEX invoke-static -> typed boundary -> process ->
# guest AArch64 registers and instructions, no JNIEnv claim.
find_program(ORDAX_NODE_EXECUTABLE NAMES node node.exe REQUIRED)
set(ORDAX_NATIVE_ADD_FIXTURE "${CMAKE_CURRENT_BINARY_DIR}/mobile-add-i32.elf")
add_test(NAME mobile-native-add-fixture
         COMMAND ordax_mobile_guest_tests --emit-i32-fixture
                 "${ORDAX_NATIVE_ADD_FIXTURE}")
set_tests_properties(mobile-native-add-fixture PROPERTIES
    FIXTURES_SETUP mobile-native-add-fixture)
add_test(NAME mobile-native-i32-arg-result
         COMMAND ordax-mobile-guest invoke-i32-elf
                 "${ORDAX_NATIVE_ADD_FIXTURE}" 40)
set_tests_properties(mobile-native-i32-arg-result PROPERTIES
    FIXTURES_REQUIRED mobile-native-add-fixture
    PASS_REGULAR_EXPRESSION "\"value\":42")
add_test(NAME mobile-dex-to-arm64-bridge
         COMMAND "${ORDAX_NODE_EXECUTABLE}"
                 "${CMAKE_CURRENT_SOURCE_DIR}/../tests/native-bridge.test.mjs"
                 "$<TARGET_FILE:ordax-mobile-guest>"
                 "${ORDAX_NATIVE_ADD_FIXTURE}")
set_tests_properties(mobile-dex-to-arm64-bridge PROPERTIES
    FIXTURES_REQUIRED mobile-native-add-fixture)

# ABI-shaped JNIEnv test: actual indexes and AArch64 indirect BLR.
add_executable(ordax_mobile_jni_guest_tests tests/jni_guest.test.cpp)
target_link_libraries(ordax_mobile_jni_guest_tests PRIVATE ordax_mobile_guest)
add_test(NAME mobile-jni-table-abi-proof COMMAND ordax_mobile_jni_guest_tests)
set(ORDAX_JNI_FIXTURE "${CMAKE_CURRENT_BINARY_DIR}/mobile-jni-static-i32.elf")
add_test(NAME mobile-jni-elf-fixture
         COMMAND ordax_mobile_jni_guest_tests --emit-jni-fixture
                 "${ORDAX_JNI_FIXTURE}")
set_tests_properties(mobile-jni-elf-fixture PROPERTIES FIXTURES_SETUP mobile-jni-fixture)
add_test(NAME mobile-jni-elf-cli-call
         COMMAND ordax-mobile-guest invoke-jni-i32-elf
                 "${ORDAX_JNI_FIXTURE}" 40)
set_tests_properties(mobile-jni-elf-cli-call PROPERTIES
    FIXTURES_REQUIRED mobile-jni-fixture
    PASS_REGULAR_EXPRESSION "\"value\":65582")
add_test(NAME mobile-dex-to-jni-aarch64-bridge
         COMMAND "${ORDAX_NODE_EXECUTABLE}"
                 "${CMAKE_CURRENT_SOURCE_DIR}/../tests/native-bridge.test.mjs"
                 "$<TARGET_FILE:ordax-mobile-guest>"
                 "${ORDAX_JNI_FIXTURE}" jni)
set_tests_properties(mobile-dex-to-jni-aarch64-bridge PROPERTIES
    FIXTURES_REQUIRED mobile-jni-fixture)

# Full array roundtrip: Dalvik new-array/aput → JNI Get/SetIntArrayRegion → aget.
set(ORDAX_JNI_ARRAY_FIXTURE "${CMAKE_CURRENT_BINARY_DIR}/mobile-jni-int-array.elf")
add_test(NAME mobile-jni-array-elf-fixture
         COMMAND ordax_mobile_jni_guest_tests --emit-jni-array-fixture
                 "${ORDAX_JNI_ARRAY_FIXTURE}")
set_tests_properties(mobile-jni-array-elf-fixture PROPERTIES
    FIXTURES_SETUP mobile-jni-array-fixture)
add_test(NAME mobile-dex-jni-array-roundtrip
         COMMAND "${ORDAX_NODE_EXECUTABLE}"
                 "${CMAKE_CURRENT_SOURCE_DIR}/../tests/native-bridge.test.mjs"
                 "$<TARGET_FILE:ordax-mobile-guest>"
                 "${ORDAX_JNI_ARRAY_FIXTURE}" jni-array)
set_tests_properties(mobile-dex-jni-array-roundtrip PROPERTIES
    FIXTURES_REQUIRED mobile-jni-array-fixture)
