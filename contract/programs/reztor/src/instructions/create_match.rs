use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ReztorError,
    events::MatchCreated,
    state::{Config, Match, MatchStatus, CONFIG_SEED, MATCH_SEED, VAULT_SEED},
};

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct CreateMatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ReztorError::Unauthorized,
        has_one = mint @ ReztorError::InvalidMint,
        constraint = !config.paused @ ReztorError::Paused
    )]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = Match::DISCRIMINATOR.len() + Match::INIT_SPACE,
        seeds = [MATCH_SEED, &match_id.to_le_bytes()],
        bump
    )]
    pub match_account: Account<'info, Match>,
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, match_account.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = match_account,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_match(
    ctx: Context<CreateMatch>,
    match_id: u64,
    players: [Pubkey; 4],
) -> Result<()> {
    for (i, player) in players.iter().enumerate() {
        require_keys_neq!(*player, Pubkey::default(), ReztorError::InvalidPlayer);
        for other in players.iter().skip(i.saturating_add(1)) {
            require_keys_neq!(*player, *other, ReztorError::DuplicatePlayer);
        }
    }

    let config = &ctx.accounts.config;
    ctx.accounts.match_account.set_inner(Match {
        match_id,
        bump: ctx.bumps.match_account,
        vault_bump: ctx.bumps.vault,
        mint: config.mint,
        buy_in_amount: config.buy_in_amount,
        credits_per_buy_in: config.credits_per_buy_in,
        rake_bps: config.rake_bps,
        void_timeout_secs: config.void_timeout_secs,
        players,
        joined_mask: 0,
        status: MatchStatus::Open,
        created_at: Clock::get()?.unix_timestamp,
        started_at: 0,
    });

    emit!(MatchCreated { match_id, players });
    Ok(())
}
