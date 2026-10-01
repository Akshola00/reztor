use anchor_lang::prelude::*;

use crate::{
    errors::ReztorError,
    events::ConfigUpdated,
    program::Reztor,
    state::{Config, CONFIG_SEED},
};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ReztorError::Unauthorized)]
    pub program: Program<'info, Reztor>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ ReztorError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handle_initialize_config(
    ctx: Context<InitializeConfig>,
    authority: Pubkey,
    mint: Pubkey,
    treasury: Pubkey,
    buy_in_amount: u64,
    credits_per_buy_in: u32,
    rake_bps: u16,
    void_timeout_secs: i64,
) -> Result<()> {
    ctx.accounts.config.set_inner(Config {
        admin: ctx.accounts.admin.key(),
        authority,
        mint,
        treasury,
        buy_in_amount,
        credits_per_buy_in,
        rake_bps,
        void_timeout_secs,
        paused: false,
        bump: ctx.bumps.config,
    });
    ctx.accounts.config.validate()?;
    emit!(ConfigUpdated::from(&*ctx.accounts.config));
    Ok(())
}
