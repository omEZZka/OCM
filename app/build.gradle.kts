plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersionName = (findProperty("appVersionName") as String?) ?: "2.4.1"
val appVersionCode = ((findProperty("appVersionCode") as String?) ?: "241").toInt()
val ksPass = System.getenv("KEYSTORE_PASSWORD")?.takeIf { it.isNotEmpty() } ?: "opencodemob"

android {
    namespace = "app.opencodemob"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.opencodemob"
        minSdk = 30
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
        ndk { abiFilters.add("arm64-v8a") }
        buildConfigField("String", "GITHUB_REPO", "\"omEZZka/OCM\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"${System.getenv("GOOGLE_WEB_CLIENT_ID") ?: ""}\"")
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore/release.jks")
            storePassword = ksPass
            keyAlias = "opencodemob"
            keyPassword = ksPass
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    androidResources { noCompress += listOf("xz") }
    // proot and its loader ship as native libs: this is the only way to exec them on Android 10+
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("org.apache.commons:commons-compress:1.27.1")
    implementation("org.tukaani:xz:1.10")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
