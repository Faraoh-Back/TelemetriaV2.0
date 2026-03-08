#[cfg(feature = "kvaser")]
pub mod canlib {
    use std::os::raw::{c_int, c_uint, c_ulong, c_void};

    pub const canOK: c_int = 0;
    pub const canBITRATE_500K: c_int = -6;
    pub const canBITRATE_250K: c_int = -5;
    pub const canOPEN_ACCEPT_VIRTUAL: c_int = 0x20;
    pub const canMSG_EXT: c_uint = 0x04;

    #[link(name = "canlib")]
    extern "C" {
        pub fn canInitializeLibrary();
        pub fn canOpenChannel(channel: c_int, flags: c_int) -> c_int;
        pub fn canSetBusParams(handle: c_int, freq: c_int, tseg1: c_uint,
            tseg2: c_uint, sjw: c_uint, noSamp: c_uint, syncmode: c_uint) -> c_int;
        pub fn canBusOn(handle: c_int) -> c_int;
        pub fn canBusOff(handle: c_int) -> c_int;
        pub fn canClose(handle: c_int) -> c_int;
        pub fn canReadWait(handle: c_int, id: *mut c_ulong, msg: *mut c_void,
            dlc: *mut c_uint, flag: *mut c_uint, time: *mut c_ulong,
            timeout_ms: c_ulong) -> c_int;
    }
}