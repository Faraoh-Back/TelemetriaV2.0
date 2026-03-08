fn main() {
    #[cfg(feature = "kvaser")]
    {
        println!("cargo:rustc-link-lib=canlib");
        println!("cargo:rustc-link-search=/lib");
    }
}