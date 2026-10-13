#include "ordax/mobile/elf_a64.hpp"

#include <cassert>
#include <cstdint>
#include <iostream>
#include <vector>

using ordax::mobile::CpuA64;
using ordax::mobile::GuestFault;
using ordax::mobile::loadRelocatableElfA64;
using ordax::mobile::runGuestInitializers;

namespace {
void put16(std::vector<std::uint8_t>& v, std::size_t i, std::uint16_t x) {
    for (unsigned j=0;j<2;++j) v[i+j]=static_cast<std::uint8_t>(x>>(8*j));
}
void put32(std::vector<std::uint8_t>& v, std::size_t i, std::uint32_t x) {
    for (unsigned j=0;j<4;++j) v[i+j]=static_cast<std::uint8_t>(x>>(8*j));
}
void put64(std::vector<std::uint8_t>& v, std::size_t i, std::uint64_t x) {
    for (unsigned j=0;j<8;++j) v[i+j]=static_cast<std::uint8_t>(x>>(8*j));
}
void segment(std::vector<std::uint8_t>& b, int index, std::uint32_t kind,
             std::uint32_t flags, std::uint64_t off,
             std::uint64_t address, std::uint64_t bytes) {
    const auto p=64+index*56;
    put32(b,p,kind);put32(b,p+4,flags);put64(b,p+8,off);
    put64(b,p+16,address);put64(b,p+24,address);
    put64(b,p+32,bytes);put64(b,p+40,bytes);
}
void dyn(std::vector<std::uint8_t>& b, std::size_t i,
         std::uint64_t tag, std::uint64_t value) {
    put64(b,0x320+i*16,tag);put64(b,0x328+i*16,value);
}
std::vector<std::uint8_t> ctorElf() {
    std::vector<std::uint8_t> b(0x700,0);
    b[0]=0x7f;b[1]='E';b[2]='L';b[3]='F';b[4]=2;b[5]=1;b[6]=1;
    put16(b,16,3);put16(b,18,183);put32(b,20,1);
    put64(b,24,0x1000);put64(b,32,64);
    put16(b,52,64);put16(b,54,56);put16(b,56,3);
    segment(b,0,1,5,0x200,0x1000,0x100); // PF_R | PF_X
    segment(b,1,1,6,0x300,0x3000,0x300); // PF_R | PF_W
    segment(b,2,2,6,0x320,0x3020,112);
    put32(b,0x200,0xd65f03c0); // entry: ret (not run as constructor)
    // DT_INIT: store 41 in RW segment.
    put32(b,0x220,0xd0000001); // adrp x1,+2 pages
    put32(b,0x224,0xd2800520); // movz x0,#41
    put32(b,0x228,0xf9000820); // str x0,[x1,#16]
    put32(b,0x22c,0xd65f03c0); // ret
    // DT_INIT_ARRAY[0]: increment the same value to 42.
    put32(b,0x230,0xd0000001); // adrp x1,+2 pages
    put32(b,0x234,0xf9400820); // ldr x0,[x1,#16]
    put32(b,0x238,0x91000400); // add x0,x0,#1
    put32(b,0x23c,0xf9000820); // str x0,[x1,#16]
    put32(b,0x240,0xd65f03c0); // ret
    dyn(b,0,12,0x1020); // DT_INIT
    dyn(b,1,25,0x3100); // DT_INIT_ARRAY
    dyn(b,2,27,8);      // DT_INIT_ARRAYSZ
    dyn(b,3,7,0x3180);  // DT_RELA
    dyn(b,4,8,24);      // DT_RELASZ
    dyn(b,5,9,24);      // DT_RELAENT
    dyn(b,6,0,0);       // DT_NULL
    // Relocate first array slot to address of AArch64 constructor 0x1030.
    put64(b,0x480,0x3100);put64(b,0x488,1027);put64(b,0x490,0x1030);
    return b;
}
template<typename F> void reject(F&& op) {
    bool failed=false;
    try { op(); } catch (const GuestFault&) { failed=true; }
    assert(failed);
}
} // namespace

int main() {
    const auto bytes=ctorElf();
    {
        CpuA64 cpu(0x100000);
        auto img=loadRelocatableElfA64(cpu,bytes,0x2000);
        assert(img.initializers.size()==1);
        assert(img.initializer_slots.size()==1);
        assert(cpu.guest_read_u64(0x5100)==0x3030);
        assert(cpu.guest_read_u64(0x5010)==0);
        runGuestInitializers(cpu,img,64);
        assert(cpu.guest_read_u64(0x5010)==42);
        reject([&] { runGuestInitializers(cpu,img,64); });
    }
    {
        // Linker controls order between images. Both use the SAME execution
        // engine and memory protections, and must not overwrite each other.
        CpuA64 cpu(0x100000);
        auto a=loadRelocatableElfA64(cpu,bytes,0x2000);
        auto b=loadRelocatableElfA64(cpu,bytes,0x6000);
        runGuestInitializers(cpu,a,64);
        runGuestInitializers(cpu,b,64);
        assert(cpu.guest_read_u64(0x5010)==42);
        assert(cpu.guest_read_u64(0x9010)==42);
    }
    {
        auto bad=bytes;
        dyn(bad,2,27,513);
        CpuA64 cpu(0x100000);
        reject([&] { (void)loadRelocatableElfA64(cpu,bad,0x2000); });
    }
    {
        auto bad=bytes;
        dyn(bad,2,0x6fffe005,8); // DT_INIT_ARRAYSZ missing
        CpuA64 cpu(0x100000);
        reject([&] { (void)loadRelocatableElfA64(cpu,bad,0x2000); });
    }
    {
        auto bad=bytes;
        dyn(bad,1,12,0x1030); // duplicate DT_INIT
        CpuA64 cpu(0x100000);
        reject([&] { (void)loadRelocatableElfA64(cpu,bad,0x2000); });
    }
    {
        auto bad=bytes;
        dyn(bad,0,12,0x3010); // DT_INIT points into guest data (NX)
        CpuA64 cpu(0x100000);
        reject([&] { (void)loadRelocatableElfA64(cpu,bad,0x2000); });
    }
    {
        auto bad=bytes;
        put64(bad,0x490,0x3000); // relocated constructor points at PF_W data
        CpuA64 cpu(0x100000);
        auto img=loadRelocatableElfA64(cpu,bad,0x2000);
        reject([&] { runGuestInitializers(cpu,img,64); });
        reject([&] { runGuestInitializers(cpu,img,64); }); // no partial retry
    }
    {
        CpuA64 cpu(0x100000);
        auto img=loadRelocatableElfA64(cpu,bytes,0x2000);
        reject([&] { runGuestInitializers(cpu,img,1); }); // instruction budget
        assert(img.initializers_started);
    }
    std::cout << "AArch64 ELF constructors staged then invoked safely after relocation\n";
}
