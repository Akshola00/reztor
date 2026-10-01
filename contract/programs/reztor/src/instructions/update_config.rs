use anchor_lang::prelude::*;

use crate::{
    errors::ReztorError,
    events::ConfigUpdated,
    state::{Config, CONFIG_SEED},
};

/// Each `None` leaves that field unchanged.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateConfigArgs {
    pub authority: Option<Pubkey>,
    pub mint: Option<Pubkey>,
    pub treasury: Option<Pubkey>,
    pub buy_in_amount: Option<u64>,
    pub credits_per_buy_in: Option<u32>,
    pub rake_bps: Option<u16>,
    pub void_timeout_secs: Option<i64>,
    pub paused: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ReztorError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

pub fn handle_update_config(
    ctx: Context<UpdateConfig>,
    args: UpdateConfigArgs,
    new_admin: Option<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(v) = args.authority {
        config.authority = v;
    }
    if let Some(v) = args.mint {
        config.mint = v;
    }
    if let Some(v) = args.treasury {
        config.treasury = v;
    }
    if let Some(v) = args.buy_in_amount {
        config.buy_in_amount = v;
    }
    if let Some(v) = args.credits_per_buy_in {
        config.credits_per_buy_in = v;
    }
    if let Some(v) = args.rake_bps {
        config.rake_bps = v;
    }
    if let Some(v) = args.void_timeout_secs {
        config.void_timeout_secs = v;
    }
    if let Some(v) = args.paused {
        config.paused = v;
    }
    if let Some(v) = new_admin {
        config.admin = v;
    }

    config.validate()?;

    emit!(ConfigUpdated::from(&**config));
    Ok(())
}
