// Source-only regression fixture for the genuine LLVM AArch64 ELF linker.
// No AOSP, Instagram, Android runtime, copied headers or host pointers.
// The runtime must link/read/relocate this output, not any synthetic ELF.
.text
.p2align 2
.globl JNI_OnLoad
.type JNI_OnLoad, %function
JNI_OnLoad:
    mov x19, x30
    ldr x9, [x0]
    ldr x9, [x9, #48]           // JavaVM.GetEnv (official slot 6)
    adrp x1, vm_env_slot
    add x1, x1, :lo12:vm_env_slot
    mov x2, #6
    movk x2, #1, lsl #16        // JNI_VERSION_1_6
    blr x9
    adrp x21, vm_env_slot
    ldr x21, [x21, :lo12:vm_env_slot]
    mov x0, x21
    ldr x9, [x0]
    ldr x9, [x9, #48]           // JNIEnv.FindClass
    adrp x1, class_name
    add x1, x1, :lo12:class_name
    blr x9
    mov x1, x0
    mov x0, x21
    ldr x9, [x0]
    ldr x9, [x9, #1720]         // JNIEnv.RegisterNatives (215)
    adrp x2, method_table
    add x2, x2, :lo12:method_table
    mov x3, #1
    blr x9
    mov x0, #6
    movk x0, #1, lsl #16
    mov x30, x19
    ret
.size JNI_OnLoad, .-JNI_OnLoad

.p2align 2
.type native_add, %function
native_add:
    add x0, x2, #2             // JNI static (I)I, guest jint at x2
    ret
.size native_add, .-native_add

.section .rodata
class_name:
    .asciz "test/Bridge"
method_name:
    .asciz "nativeAdd"
method_signature:
    .asciz "(I)I"

.section .data,"aw",@progbits
.p2align 3
method_table:
    .xword method_name
    .xword method_signature
    .xword native_add

.section .bss,"aw",@nobits
.p2align 3
vm_env_slot:
    .skip 8

.section .note.GNU-stack,"",@progbits
