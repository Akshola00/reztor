use anchor_lang::prelude::*;

use crate::errors::ReztorError;

pub const CONFIG_SEED: &[u8] = b"config";
pub const MATCH_SEED: &[u8] = b"match";
pub const VAULT_SEED: &[u8] = b"vault";

pub const MAX_RAKE_BPS: u16 = 1000;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub buy_in_amount: u64,
    pub credits_per_buy_in: u32,
    pub rake_bps: u16,
    pub void_timeout_secs: i64,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    /// Config invariants (contract-spec.md §3). Called by both config instructions
    /// after the new values are written.
    pub fn validate(&self) -> Result<()> {
        require!(self.credits_per_buy_in > 0, ReztorError::InvalidConfig);
        require!(self.buy_in_amount > 0, ReztorError::InvalidConfig);
        let remainder = self
            .buy_in_amount
            .checked_rem(u64::from(self.credits_per_buy_in))
            .ok_or(ReztorError::InvalidConfig)?;
        require!(remainder == 0, ReztorError::InvalidConfig);
        require!(self.rake_bps <= MAX_RAKE_BPS, ReztorError::InvalidConfig);
        require!(self.void_timeout_secs > 0, ReztorError::InvalidConfig);
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MatchStatus {
    Open,
    Active,
}

#[account]
#[derive(InitSpace)]
pub struct Match {
    pub match_id: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub mint: Pubkey,
    pub buy_in_amount: u64,
    pub credits_per_buy_in: u32,
    pub rake_bps: u16,
    pub void_timeout_secs: i64,
    pub players: [Pubkey; 4],
    pub joined_mask: u8,
    pub status: MatchStatus,
    pub created_at: i64,
    pub started_at: i64,
}
