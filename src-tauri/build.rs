use std::{env, path::PathBuf, process::Command};
fn main() {
    println!("cargo:rerun-if-changed=src/video_analysis/decoder.m");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo OUT_DIR"));
        let target = env::var("TARGET").expect("Cargo TARGET");
        let arch = if target.starts_with("aarch64") {
            "arm64"
        } else {
            "x86_64"
        };
        let status = Command::new("xcrun")
            .args([
                "clang",
                "-fobjc-arc",
                "-mmacosx-version-min=13.0",
                "-arch",
                arch,
                "-Wno-deprecated-declarations",
                "-c",
                "src/video_analysis/decoder.m",
                "-o",
            ])
            .arg(out.join("decoder.o"))
            .status()
            .expect("Xcode command line tools are required");
        assert!(status.success(), "AVFoundation decoder compilation failed");
        assert!(Command::new("xcrun")
            .args(["ar", "crs"])
            .arg(out.join("libapex_video.a"))
            .arg(out.join("decoder.o"))
            .status()
            .expect("Apple archiver")
            .success());
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=apex_video");
        for framework in [
            "Foundation",
            "AVFoundation",
            "CoreMedia",
            "CoreVideo",
            "CoreImage",
            "CoreGraphics",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    println!("cargo:rerun-if-changed=src/video_analysis/motion.cpp");
    if env::var("TARGET").as_deref() == Ok("aarch64-apple-darwin") {
        let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("../.tools/opencv-4.13.0/install");
        let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
        println!("cargo:rerun-if-changed={}", root.join("lib").display());
        assert!(
            root.join("include/opencv4/opencv2/core.hpp").exists(),
            "Run node scripts/prepare-opencv.mjs before building for Apple Silicon"
        );
        assert!(Command::new("xcrun")
            .args([
                "clang++",
                "-std=c++17",
                "-arch",
                "arm64",
                "-mmacosx-version-min=13.0",
                "-c",
                "src/video_analysis/motion.cpp",
                "-o"
            ])
            .arg(out.join("motion.o"))
            .arg("-I")
            .arg(root.join("include/opencv4"))
            .status()
            .expect("Xcode clang++")
            .success());
        assert!(Command::new("xcrun")
            .args(["ar", "crs"])
            .arg(out.join("libapex_motion.a"))
            .arg(out.join("motion.o"))
            .status()
            .expect("Apple archiver")
            .success());
        println!("cargo:rustc-link-search=native={}", out.display());
        println!(
            "cargo:rustc-link-search=native={}",
            root.join("lib").display()
        );
        println!(
            "cargo:rustc-link-search=native={}",
            root.join("lib/opencv4/3rdparty").display()
        );
        for lib in [
            "apex_motion",
            "opencv_video",
            "opencv_imgproc",
            "opencv_core",
            "tegra_hal",
        ] {
            println!("cargo:rustc-link-lib=static={lib}");
        }
        println!("cargo:rustc-link-lib=c++");
        println!("cargo:rustc-link-lib=z");
        println!("cargo:rustc-link-lib=framework=Accelerate");
    }
    tauri_build::build()
}
