#include "ordax/mobile/elf_a64.hpp"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <span>
#include <string>
#include <vector>

using ordax::mobile::CpuA64;
using ordax::mobile::GuestFault;
using ordax::mobile::GuestDynamicExport;
using ordax::mobile::inspectGuestDynamicExports;
using ordax::mobile::loadLinkedElfA64;
using ordax::mobile::loadRelocatableElfA64;

namespace {
void u16(std::vector<std::uint8_t>& b, std::size_t at, std::uint16_t n) {
    for (unsigned i=0; i<2; ++i) b[at+i] = static_cast<std::uint8_t>(n >> (8*i));
}
void u32(std::vector<std::uint8_t>& b, std::size_t at, std::uint32_t n) {
    for (unsigned i=0; i<4; ++i) b[at+i] = static_cast<std::uint8_t>(n >> (8*i));
}
void u64(std::vector<std::uint8_t>& b, std::size_t at, std::uint64_t n) {
    for (unsigned i=0; i<8; ++i) b[at+i] = static_cast<std::uint8_t>(n >> (8*i));
}
void program(std::vector<std::uint8_t>& b, int index, std::uint32_t type,
             std::uint32_t flags, std::uint64_t file, std::uint64_t virt,
             std::uint64_t bytes) {
    const auto at = 64 + static_cast<std::size_t>(index)*56;
    u32(b, at, type); u32(b, at+4, flags); u64(b, at+8, file);
    u64(b, at+16, virt); u64(b, at+24, virt);
    u64(b, at+32, bytes); u64(b, at+40, bytes);
    u64(b, at+48, 0x1000);
}
std::vector<std::uint8_t> imageHeader() {
    std::vector<std::uint8_t> b(0x700,0);
    b[0]=0x7f; b[1]='E'; b[2]='L'; b[3]='F'; b[4]=2; b[5]=1; b[6]=1;
    u16(b,16,3); u16(b,18,183); u32(b,20,1); u64(b,24,0x1000);
    u64(b,32,64); u16(b,52,64); u16(b,54,56); u16(b,56,3);
    program(b,0,1,5,0x200,0x1000,0x100);
    program(b,1,1,6,0x300,0x3000,0x300);
    return b;
}
void dyn(std::vector<std::uint8_t>& b, std::size_t i,
         std::uint64_t tag, std::uint64_t value) {
    u64(b,0x320 + i*16,tag); u64(b,0x328 + i*16,value);
}
std::vector<std::uint8_t> providerElf() {
    auto b = imageHeader();
    program(b,2,2,6,0x320,0x3020,96);
    // Real guest AArch64 function: add x0,x0,#2 ; ret x30.
    u32(b,0x200,0x91000800); u32(b,0x204,0xd65f03c0);
    dyn(b,0,4,0x3120); // DT_HASH (SysV)
    dyn(b,1,5,0x3090); // DT_STRTAB
    dyn(b,2,10,11);    // DT_STRSZ
    dyn(b,3,6,0x30c0); // DT_SYMTAB
    dyn(b,4,11,24);    // DT_SYMENT
    // DT_NULL at index 5
    const std::string str("\0increment\0",11);
    std::copy(str.begin(),str.end(),b.begin()+0x390);
    // ELF symbol #1: GLOBAL FUNC named "increment", defined in text.
    u32(b,0x3d8,1); b[0x3dc]=0x12; u16(b,0x3de,1);
    u64(b,0x3e0,0x1000); u64(b,0x3e8,8);
    u32(b,0x420,1); u32(b,0x424,2); // SysV hash nchain=2
    return b;
}
std::vector<std::uint8_t> consumerElf() {
    auto b = imageHeader();
    program(b,2,2,6,0x320,0x3020,160);
    // Caller preserves LR across BLR and invokes GOT[0] as a guest address.
    for (const auto [i,word] : std::vector<std::pair<std::size_t,std::uint32_t>>{
        {0,0x910003d3}, // add x19,x30,#0
        {1,0xd0000001}, // adrp x1, GOT page +2
        {2,0xf9400029}, // ldr x9,[x1]
        {3,0xd63f0120}, // blr x9
        {4,0x9100027e}, // add x30,x19,#0
        {5,0xd65f03c0}, // ret x30
    }) u32(b,0x200 + i*4,word);
    // Dynamic symbols: DT_NEEDED name at dynstr[1], undefined FUNC #1.
    dyn(b,0,1,1);       // DT_NEEDED "libprovider.so"
    dyn(b,1,5,0x30d0);  // DT_STRTAB
    dyn(b,2,10,26);     // DT_STRSZ
    dyn(b,3,6,0x3130);  // DT_SYMTAB
    dyn(b,4,11,24);     // DT_SYMENT
    dyn(b,5,4,0x3170);  // DT_HASH
    dyn(b,6,7,0x3180);  // DT_RELA
    dyn(b,7,8,24);      // DT_RELASZ
    dyn(b,8,9,24);      // DT_RELAENT
    const std::string str("\0libprovider.so\0increment\0",26);
    std::copy(str.begin(),str.end(),b.begin()+0x3d0);
    u32(b,0x448,16); b[0x44c]=0x12; // undefined GLOBAL FUNC #1
    u32(b,0x470,1); u32(b,0x474,2); // nchain=2
    u64(b,0x480,0x3000); // GOT[0] relocation destination
    u64(b,0x488,(std::uint64_t(1)<<32)|1026); // R_AARCH64_JUMP_SLOT
    u64(b,0x490,0); // no addend for jump slot
    return b;
}
template<class F> void reject(F&& f) {
    bool failed=false;
    try { f(); } catch (const GuestFault&) { failed=true; }
    assert(failed);
}
} // namespace

int main() {
    const auto provider = providerElf();
    const auto client = consumerElf();
    {
        CpuA64 cpu(0x100000);
        const auto image = loadRelocatableElfA64(cpu,provider,0x10000);
        assert(image.entry==0x11000);
        const auto exports=inspectGuestDynamicExports(provider,0x10000,"libprovider.so");
        assert(exports.size()==1 && exports[0].symbol=="increment");
        assert(exports[0].address==0x11000);
        const auto linked=loadLinkedElfA64(cpu,client,0x30000,exports);
        assert(linked.entry==0x31000 && linked.relative_relocations==1);
        cpu.set_register(0,40);
        assert(cpu.run(linked.entry,30)==42); // cross-image real guest BLR
    }
    {
        CpuA64 cpu(0x100000);
        loadRelocatableElfA64(cpu,provider,0x10000);
        const auto exports=inspectGuestDynamicExports(provider,0x10000,"libprovider.so");
        reject([&]{ loadLinkedElfA64(cpu,client,0x10000,exports); }); // overlap
        reject([&]{ loadLinkedElfA64(cpu,client,0x30000,{}); }); // no implicit resolution
        auto wrong=exports; wrong[0].library="libother.so";
        reject([&]{ loadLinkedElfA64(cpu,client,0x30000,wrong); });
        wrong=exports; wrong[0].symbol="other";
        reject([&]{ loadLinkedElfA64(cpu,client,0x30000,wrong); });
        wrong=exports; wrong[0].address=0x13000; // RW, not executable
        reject([&]{ loadLinkedElfA64(cpu,client,0x30000,wrong); });
        auto duplicated=exports; duplicated.push_back(exports[0]);
        reject([&]{ loadLinkedElfA64(cpu,client,0x30000,duplicated); });
        auto bad=client;
        u64(bad,0x488,(std::uint64_t(1)<<32)|1030); // TLS desc unsupported
        reject([&]{ loadLinkedElfA64(cpu,bad,0x30000,exports); });
        bad=client; u64(bad,0x480,0x1000); // relocation in RX
        reject([&]{ loadLinkedElfA64(cpu,bad,0x30000,exports); });
        bad=client; dyn(bad,0,1,300); // invalid DT_NEEDED string index
        reject([&]{ loadLinkedElfA64(cpu,bad,0x30000,exports); });
        // Failed link attempts must not poison CPU protection map or GOT.
        cpu.set_register(0,40);
        const auto recovered=loadLinkedElfA64(cpu,client,0x30000,exports);
        assert(cpu.run(recovered.entry,30)==42);
    }
    std::cout<<"Bounded AArch64 cross-ELF JUMP_SLOT linking passed\n";
}
