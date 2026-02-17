use sha2::{Digest, Sha256};
use std::collections::HashSet;

/// Hash an API key using SHA-256
pub fn hash_api_key(api_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(api_key.as_bytes());
    hex::encode(hasher.finalize())
}

/// Validate API key against list of valid keys (O(n) - kept for backwards compatibility)
#[allow(dead_code)] // Public API for backwards compatibility
pub fn validate_api_key(api_key: &str, valid_keys: &[String]) -> bool {
    valid_keys.iter().any(|k| k == api_key)
}

/// API Key Validator using HashSet for O(1) lookups
/// Use this for high-throughput scenarios with many agents
#[derive(Clone)]
pub struct ApiKeyValidator {
    valid_keys: HashSet<String>,
}

impl ApiKeyValidator {
    /// Create a new validator from a list of API keys
    pub fn new(keys: Vec<String>) -> Self {
        Self {
            valid_keys: keys.into_iter().collect(),
        }
    }

    /// Validate an API key - O(1) lookup
    pub fn validate(&self, api_key: &str) -> bool {
        self.valid_keys.contains(api_key)
    }

    /// Get the number of valid keys
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.valid_keys.len()
    }

    /// Check if validator has no keys
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.valid_keys.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_api_key() {
        let key = "test-api-key";
        let hash = hash_api_key(key);
        assert_eq!(hash.len(), 64); // SHA-256 produces 64 hex chars
    }

    #[test]
    fn test_validate_api_key() {
        let keys = vec!["key1".to_string(), "key2".to_string()];
        assert!(validate_api_key("key1", &keys));
        assert!(validate_api_key("key2", &keys));
        assert!(!validate_api_key("key3", &keys));
    }
}
