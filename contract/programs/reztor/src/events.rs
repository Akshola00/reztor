use anchor_lang::prelude::*;

/// Carries the full config after the change, so listeners don't need to refetch.
#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub buy_in_amount: u64,
    pub credits_per_buy_in: u32,
    pub rake_bps: u16,
    pub void_timeout_secs: i64,
    pub paused: bool,
}

#[event]
pub struct MatchCreated {
    pub match_id: u64,
    pub players: [Pubkey; 4],
}

#[event]
pub struct PlayerJoined {
    pub match_id: u64,
    pub seat: u8,
    pub player: Pubkey,
}

#[event]
pub struct MatchStarted {
    pub match_id: u64,
}

#[event]
pub struct MatchSettled {
    pub match_id: u64,
    pub payouts: [u64; 4],
    pub treasury_amount: u64,
    pub winners_mask: u8,
}

#[event]
pub struct MatchVoided {
    pub match_id: u64,
    pub refunded_seats_mask: u8,
    pub by_authority: bool,
}
