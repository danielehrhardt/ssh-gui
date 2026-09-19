use serde::Serialize;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("key '{0}' not found")]
    NotFound(String),
    #[error("'{0}' already exists")]
    AlreadyExists(String),
    #[error("invalid key name '{0}': {1}")]
    InvalidName(String, &'static str),
    #[error("invalid key: {0}")]
    InvalidKey(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("ssh-agent: {0}")]
    Agent(String),
    #[error("this key is protected — a passphrase is required")]
    PassphraseRequired,
    #[error("incorrect passphrase")]
    IncorrectPassphrase,
    #[error("could not move to trash: {0}")]
    Trash(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

impl Error {
    /// Stable machine-readable identifier, used by the GUI, CLI (--json) and MCP server.
    pub fn code(&self) -> &'static str {
        match self {
            Error::NotFound(_) => "not_found",
            Error::AlreadyExists(_) => "already_exists",
            Error::InvalidName(..) => "invalid_name",
            Error::InvalidKey(_) => "invalid_key",
            Error::Unsupported(_) => "unsupported",
            Error::Agent(_) => "agent",
            Error::PassphraseRequired => "passphrase_required",
            Error::IncorrectPassphrase => "incorrect_passphrase",
            Error::Trash(_) => "trash",
            Error::Io(_) => "io",
        }
    }
}

impl From<ssh_key::Error> for Error {
    fn from(e: ssh_key::Error) -> Self {
        Error::InvalidKey(e.to_string())
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}
