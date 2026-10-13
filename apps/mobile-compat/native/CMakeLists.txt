cmake_minimum_required(VERSION 3.20)
project(ordax_mobile_guest VERSION 0.1.0 LANGUAGES CXX)

add_library(ordax_mobile_guest STATIC src/cpu_a64.cpp src/elf_a64.cpp src/android_aps2.cpp src/jni_guest.cpp src/jni_registration.cpp)
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

# JNI-created jintArray return: native NewIntArray + SetIntArrayRegion →
# opaque reference, validated snapshot and guest-owned Dalvik aget.
set(ORDAX_JNI_RETURN_ARRAY_FIXTURE "${CMAKE_CURRENT_BINARY_DIR}/mobile-jni-return-int-array.elf")
add_test(NAME mobile-jni-return-array-elf-fixture
         COMMAND ordax_mobile_jni_guest_tests --emit-jni-new-array-fixture
                 "${ORDAX_JNI_RETURN_ARRAY_FIXTURE}")
set_tests_properties(mobile-jni-return-array-elf-fixture PROPERTIES
    FIXTURES_SETUP mobile-jni-return-array-fixture)
add_test(NAME mobile-dex-jni-new-array-roundtrip
         COMMAND "${ORDAX_NODE_EXECUTABLE}"
                 "${CMAKE_CURRENT_SOURCE_DIR}/../tests/native-bridge.test.mjs"
                 "$<TARGET_FILE:ordax-mobile-guest>"
                 "${ORDAX_JNI_RETURN_ARRAY_FIXTURE}" jni-new-array)
set_tests_properties(mobile-dex-jni-new-array-roundtrip PROPERTIES
    FIXTURES_REQUIRED mobile-jni-return-array-fixture)

# Linked guest ELF: dynamic DT_NEEDED and R_AARCH64_JUMP_SLOT between two
# explicitly mapped AArch64 ET_DYN images without host symbol loading.
add_executable(ordax_mobile_linked_elf_tests tests/elf_linked.test.cpp)
target_link_libraries(ordax_mobile_linked_elf_tests PRIVATE ordax_mobile_guest)
add_test(NAME mobile-a64-cross-elf-jump-slot-proof COMMAND ordax_mobile_linked_elf_tests)

# Execute two actual ELF files through the bounded Windows/Linux host CLI.
# This is a guest-to-guest dependency proof, not the Android Bionic loader.
set(ORDAX_LINK_PROVIDER "${CMAKE_CURRENT_BINARY_DIR}/libprovider.so")
set(ORDAX_LINK_CONSUMER "${CMAKE_CURRENT_BINARY_DIR}/libconsumer.so")
add_test(NAME mobile-linked-elf-files-fixture
         COMMAND ordax_mobile_linked_elf_tests --emit-linked-fixtures
                 "${ORDAX_LINK_PROVIDER}" "${ORDAX_LINK_CONSUMER}")
set_tests_properties(mobile-linked-elf-files-fixture PROPERTIES
    FIXTURES_SETUP mobile-linked-elf-files)
add_test(NAME mobile-linked-elf-files-run
         COMMAND ordax-mobile-guest link-two-elf
                 "${ORDAX_LINK_PROVIDER}" "${ORDAX_LINK_CONSUMER}" 40)
set_tests_properties(mobile-linked-elf-files-run PROPERTIES
    FIXTURES_REQUIRED mobile-linked-elf-files
    PASS_REGULAR_EXPRESSION "guestReturn.*42")


# Packed Android APS2 decoding is a pure parser; only the original ELF loader
# is permitted to apply these relocations to guest memory.
add_executable(ordax_mobile_aps2_decoder_tests tests/android_aps2.test.cpp)
target_link_libraries(ordax_mobile_aps2_decoder_tests PRIVATE ordax_mobile_guest)
add_test(NAME mobile-a64-aps2-format-and-bounds-proof
         COMMAND ordax_mobile_aps2_decoder_tests)

# Host-driven ELF constructors: DT_INIT then relocated DT_INIT_ARRAY.
# They never run during parsing or while resolving dependencies.
add_executable(ordax_mobile_initializer_tests tests/elf_initializers.test.cpp)
target_link_libraries(ordax_mobile_initializer_tests PRIVATE ordax_mobile_guest)
add_test(NAME mobile-a64-elf-initializer-order-and-security
         COMMAND ordax_mobile_initializer_tests)

# Genuine JNI_OnLoad(JavaVM*,void*) obtained by DT_SONAME + dynsym from
# an actual ELF file; caller uses the same verified guest CPU/JNI lifecycle.
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/jni-onload")
set(ORDAX_ONLOAD_ELF "${CMAKE_CURRENT_BINARY_DIR}/jni-onload/libprovider.so")
add_test(NAME mobile-jni-onload-elf-fixture
         COMMAND ordax_mobile_linked_elf_tests --emit-jni-onload-fixture
                 "${ORDAX_ONLOAD_ELF}")
set_tests_properties(mobile-jni-onload-elf-fixture PROPERTIES
    FIXTURES_SETUP mobile-jni-onload-fixture)
add_test(NAME mobile-jni-onload-elf-file-proof
         COMMAND ordax-mobile-guest invoke-jni-onload-elf
                 "${ORDAX_ONLOAD_ELF}")
set_tests_properties(mobile-jni-onload-elf-file-proof PROPERTIES
    FIXTURES_REQUIRED mobile-jni-onload-fixture
    PASS_REGULAR_EXPRESSION "version.*65542")

# Genuine DEX -> NativeMethodBoundary -> pinned ELF JNI_OnLoad ->
# FindClass -> RegisterNatives -> guest AArch64 jint method -> Dalvik.
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/jni-registered")
set(ORDAX_REGISTERED_JNI_ELF "${CMAKE_CURRENT_BINARY_DIR}/jni-registered/libprovider.so")
add_test(NAME mobile-jni-registered-fixture
         COMMAND ordax_mobile_linked_elf_tests --emit-jni-register-fixture
                 "${ORDAX_REGISTERED_JNI_ELF}")
set_tests_properties(mobile-jni-registered-fixture PROPERTIES
    FIXTURES_SETUP mobile-jni-registered-fixture)
add_test(NAME mobile-jni-registered-elf-file-proof
         COMMAND ordax-mobile-guest invoke-jni-registered-i32-elf
                 "${ORDAX_REGISTERED_JNI_ELF}" test/Bridge nativeAdd "(I)I" 40)
set_tests_properties(mobile-jni-registered-elf-file-proof PROPERTIES
    FIXTURES_REQUIRED mobile-jni-registered-fixture
    PASS_REGULAR_EXPRESSION "\"value\":42")
add_test(NAME mobile-dex-to-jni-registered-arm64
         COMMAND "${ORDAX_NODE_EXECUTABLE}"
                 "${CMAKE_CURRENT_SOURCE_DIR}/../tests/native-bridge.test.mjs"
                 "$<TARGET_FILE:ordax-mobile-guest>"
                 "${ORDAX_REGISTERED_JNI_ELF}" jni-registered)
set_tests_properties(mobile-dex-to-jni-registered-arm64 PROPERTIES
    FIXTURES_REQUIRED mobile-jni-registered-fixture)


# Real LLVM/LLD-linked AArch64 ELF produced by CI, from checked-in assembly.
# Not a copied Android binary and not an independent execution engine.
set(ORDAX_LLVM_GUEST_ELF "${CMAKE_CURRENT_BINARY_DIR}/llvm-guest/libprovider.so")
if(EXISTS "${ORDAX_LLVM_GUEST_ELF}")
  add_test(NAME mobile-real-llvm-linked-elf-jni-register
           COMMAND ordax-mobile-guest invoke-jni-registered-i32-elf
                   "${ORDAX_LLVM_GUEST_ELF}" test/Bridge nativeAdd "(I)I" 40)
  set_tests_properties(mobile-real-llvm-linked-elf-jni-register PROPERTIES
      PASS_REGULAR_EXPRESSION "value.*42")
  add_test(NAME mobile-real-llvm-dex-to-jni-registered
           COMMAND "${ORDAX_NODE_EXECUTABLE}"
                   "${CMAKE_CURRENT_SOURCE_DIR}/../tests/native-bridge.test.mjs"
                   "$<TARGET_FILE:ordax-mobile-guest>"
                   "${ORDAX_LLVM_GUEST_ELF}" jni-registered)
  add_test(NAME mobile-real-llvm-linked-elf-reject-wrong-class
           COMMAND ordax-mobile-guest invoke-jni-registered-i32-elf
                   "${ORDAX_LLVM_GUEST_ELF}" unauthorized/Class nativeAdd "(I)I" 40)
  set_tests_properties(mobile-real-llvm-linked-elf-reject-wrong-class PROPERTIES
      WILL_FAIL TRUE)
endif()
