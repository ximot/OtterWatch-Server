use log::{info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// Information about an available update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub checksum: String,
    pub filename: String,
    pub size: u64,
}

/// Response for latest version endpoint
#[allow(dead_code)] // Public API
#[derive(Debug, Serialize)]
pub struct LatestVersionResponse {
    pub version: String,
    pub checksum: String,
    pub download_url: String,
    pub size: u64,
}

/// Manages agent update binaries
pub struct UpdateManager {
    updates_dir: PathBuf,
    /// Cache of version -> UpdateInfo
    versions: RwLock<HashMap<String, UpdateInfo>>,
    /// The latest version available
    latest_version: RwLock<Option<String>>,
}

impl UpdateManager {
    pub fn new(updates_dir: impl AsRef<Path>) -> Self {
        let manager = Self {
            updates_dir: updates_dir.as_ref().to_path_buf(),
            versions: RwLock::new(HashMap::new()),
            latest_version: RwLock::new(None),
        };
        manager.scan_updates();
        manager
    }

    /// Scans the updates directory for available binaries
    pub fn scan_updates(&self) {
        let dir = &self.updates_dir;

        if !dir.exists() {
            info!("Updates directory does not exist, creating: {:?}", dir);
            if let Err(e) = fs::create_dir_all(dir) {
                warn!("Failed to create updates directory: {}", e);
                return;
            }
        }

        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(e) => {
                warn!("Failed to read updates directory: {}", e);
                return;
            }
        };

        let mut versions = HashMap::new();
        let mut latest: Option<(String, UpdateInfo)> = None;

        for entry in entries.flatten() {
            let path = entry.path();

            // Skip non-files
            if !path.is_file() {
                continue;
            }

            let filename = match path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };

            // Expected format: otterwatch-{version} or otterwatch-{version}.exe
            if !filename.starts_with("otterwatch-") {
                continue;
            }

            // Extract version from filename
            let version = filename
                .trim_start_matches("otterwatch-")
                .trim_end_matches(".exe")
                .to_string();

            if version.is_empty() {
                continue;
            }

            // Calculate checksum
            let checksum = match calculate_sha256(&path) {
                Ok(hash) => hash,
                Err(e) => {
                    warn!("Failed to calculate checksum for {:?}: {}", path, e);
                    continue;
                }
            };

            // Get file size
            let size = match fs::metadata(&path) {
                Ok(meta) => meta.len(),
                Err(_) => continue,
            };

            let info = UpdateInfo {
                version: version.clone(),
                checksum,
                filename,
                size,
            };

            // Track latest version (simple semver comparison)
            if latest.is_none() || compare_versions(&version, &latest.as_ref().unwrap().0) > 0 {
                latest = Some((version.clone(), info.clone()));
            }

            versions.insert(version, info);
        }

        let count = versions.len();
        *self.versions.write().unwrap() = versions;
        *self.latest_version.write().unwrap() = latest.map(|(v, _)| v);

        info!("Scanned {} update versions from {:?}", count, dir);
    }

    /// Returns info about the latest available version
    pub fn get_latest(&self) -> Option<UpdateInfo> {
        let latest = self.latest_version.read().unwrap();
        let versions = self.versions.read().unwrap();

        latest.as_ref().and_then(|v| versions.get(v).cloned())
    }

    /// Returns info about a specific version
    pub fn get_version(&self, version: &str) -> Option<UpdateInfo> {
        self.versions.read().unwrap().get(version).cloned()
    }

    /// Returns the path to a binary file for download
    pub fn get_binary_path(&self, version: &str) -> Option<PathBuf> {
        let info = self.get_version(version)?;
        let path = self.updates_dir.join(&info.filename);

        if path.exists() {
            Some(path)
        } else {
            None
        }
    }

    /// Lists all available versions
    pub fn list_versions(&self) -> Vec<UpdateInfo> {
        self.versions.read().unwrap().values().cloned().collect()
    }

    /// Adds a new binary to the updates directory
    #[allow(dead_code)] // Public API for future use
    pub fn add_binary(&self, version: &str, data: &[u8]) -> Result<UpdateInfo, String> {
        let filename = format!("otterwatch-{}", version);
        let path = self.updates_dir.join(&filename);

        fs::write(&path, data).map_err(|e| format!("Failed to write binary: {}", e))?;

        // Set executable permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o755);
            fs::set_permissions(&path, perms)
                .map_err(|e| format!("Failed to set permissions: {}", e))?;
        }

        let checksum =
            calculate_sha256(&path).map_err(|e| format!("Failed to calculate checksum: {}", e))?;

        let info = UpdateInfo {
            version: version.to_string(),
            checksum,
            filename,
            size: data.len() as u64,
        };

        // Update cache
        {
            let mut versions = self.versions.write().unwrap();
            versions.insert(version.to_string(), info.clone());
        }

        // Update latest if this is newer
        {
            let mut latest = self.latest_version.write().unwrap();
            if latest.is_none() || compare_versions(version, latest.as_ref().unwrap()) > 0 {
                *latest = Some(version.to_string());
            }
        }

        info!("Added update binary: {} ({})", version, info.checksum);
        Ok(info)
    }
}

/// Calculates SHA256 hash of a file
fn calculate_sha256(path: &Path) -> Result<String, std::io::Error> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Simple semver-like version comparison
/// Returns: >0 if a > b, <0 if a < b, 0 if equal
fn compare_versions(a: &str, b: &str) -> i32 {
    let parse =
        |s: &str| -> Vec<u32> { s.split('.').filter_map(|part| part.parse().ok()).collect() };

    let va = parse(a);
    let vb = parse(b);

    for i in 0..va.len().max(vb.len()) {
        let pa = va.get(i).copied().unwrap_or(0);
        let pb = vb.get(i).copied().unwrap_or(0);

        if pa > pb {
            return 1;
        } else if pa < pb {
            return -1;
        }
    }

    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_versions() {
        assert!(compare_versions("0.2.0", "0.1.0") > 0);
        assert!(compare_versions("0.1.0", "0.2.0") < 0);
        assert_eq!(compare_versions("0.1.0", "0.1.0"), 0);
        assert!(compare_versions("1.0.0", "0.9.9") > 0);
        assert!(compare_versions("0.1.1", "0.1.0") > 0);
    }
}
