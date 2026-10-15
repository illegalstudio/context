use anyhow::{Result, bail};
use std::sync::OnceLock;
use tiktoken_rs::CoreBPE;

pub struct Tokenizer {
    name: String,
    encoder: Option<&'static CoreBPE>,
}

impl Tokenizer {
    pub fn validate(name: &str) -> Result<()> {
        if !matches!(name, "approx" | "cl100k_base" | "o200k_base") {
            bail!("Unknown tokenizer {name}; choose approx, cl100k_base or o200k_base");
        }
        Ok(())
    }

    pub fn new(name: &str) -> Result<Self> {
        Self::validate(name)?;
        static CL100K: OnceLock<CoreBPE> = OnceLock::new();
        static O200K: OnceLock<CoreBPE> = OnceLock::new();
        let encoder = match name {
            "cl100k_base" => Some(CL100K.get_or_init(|| {
                tiktoken_rs::cl100k_base().expect("Embedded cl100k_base vocabulary is valid")
            })),
            "o200k_base" => Some(O200K.get_or_init(|| {
                tiktoken_rs::o200k_base().expect("Embedded o200k_base vocabulary is valid")
            })),
            _ => None,
        };
        Ok(Self {
            name: name.into(),
            encoder,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn count(&self, text: &str) -> usize {
        match self.encoder {
            Some(encoder) => encoder.encode_ordinary(text).len(),
            None => text.len().div_ceil(4),
        }
    }
}
