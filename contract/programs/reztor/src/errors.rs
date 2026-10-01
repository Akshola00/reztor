use anchor_lang::prelude::*;

#[error_code]
pub enum ReztorError {
    #[msg("Program is paused")]
    Paused,
    #[msg("Config violates an invariant")]
    InvalidConfig,
    #[msg("Players must be non-default and distinct")]
    DuplicatePlayer,
    #[msg("Signer is not seated in this match")]
    NotSeated,
    #[msg("Seat has already joined")]
    AlreadyJoined,
    #[msg("Match is not open")]
    MatchNotOpen,
    #[msg("Match is not active")]
    MatchNotActive,
    #[msg("Winners mask is invalid")]
    InvalidWinners,
    #[msg("Unspent credits exceed the buy-in")]
    UnspentExceedsBuyIn,
    #[msg("Token account is invalid")]
    InvalidTokenAccount,
    #[msg("Wrong number of remaining accounts")]
    WrongRemainingAccountsCount,
    #[msg("Void timeout has not been reached")]
    VoidTimeoutNotReached,
    #[msg("Signer is not authorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Vault holds less than the escrowed amount")]
    VaultUnderfunded,
    #[msg("Payouts do not sum to the vault balance")]
    PayoutMismatch,
}
