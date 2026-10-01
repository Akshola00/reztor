pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use instructions::*;

declare_id!("4hAFR3JFKmE5GkJFDSVUHB1LwcsZkQBszCq9kwFu5MHZ");

#[program]
pub mod reztor {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        authority: Pubkey,
        mint: Pubkey,
        treasury: Pubkey,
        buy_in_amount: u64,
        credits_per_buy_in: u32,
        rake_bps: u16,
        void_timeout_secs: i64,
    ) -> Result<()> {
        instructions::initialize_config::handle_initialize_config(
            ctx,
            authority,
            mint,
            treasury,
            buy_in_amount,
            credits_per_buy_in,
            rake_bps,
            void_timeout_secs,
        )
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        args: UpdateConfigArgs,
        new_admin: Option<Pubkey>,
    ) -> Result<()> {
        instructions::update_config::handle_update_config(ctx, args, new_admin)
    }

    pub fn create_match(
        ctx: Context<CreateMatch>,
        match_id: u64,
        players: [Pubkey; 4],
    ) -> Result<()> {
        instructions::create_match::handle_create_match(ctx, match_id, players)
    }

    pub fn join_match(ctx: Context<JoinMatch>, match_id: u64) -> Result<()> {
        instructions::join_match::handle_join_match(ctx, match_id)
    }

    pub fn settle_match(ctx: Context<SettleMatch>) -> Result<()> {
        instructions::settle_match::handle_settle_match(ctx)
    }

    pub fn void_match(ctx: Context<VoidMatch>) -> Result<()> {
        instructions::void_match::handle_void_match(ctx)
    }
}
