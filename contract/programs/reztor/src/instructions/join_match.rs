use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    errors::ReztorError,
    events::{MatchStarted, PlayerJoined},
    state::{Config, Match, MatchStatus, CONFIG_SEED, MATCH_SEED, VAULT_SEED},
};

const ALL_SEATS_JOINED: u8 = 0b1111;

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct JoinMatch<'info> {
    pub player: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ ReztorError::Paused
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [MATCH_SEED, &match_id.to_le_bytes()],
        bump = match_account.bump,
        has_one = mint @ ReztorError::InvalidMint,
        constraint = match_account.status == MatchStatus::Open @ ReztorError::MatchNotOpen
    )]
    pub match_account: Account<'info, Match>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = player,
        token::token_program = token_program
    )]
    pub player_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [VAULT_SEED, match_account.key().as_ref()],
        bump = match_account.vault_bump,
        token::mint = mint,
        token::authority = match_account,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_join_match(ctx: Context<JoinMatch>, match_id: u64) -> Result<()> {
    let player = ctx.accounts.player.key();
    let match_account = &ctx.accounts.match_account;

    let seat = (0u8..)
        .zip(match_account.players.iter())
        .find(|(_, p)| **p == player)
        .map(|(seat, _)| seat)
        .ok_or(ReztorError::NotSeated)?;
    let seat_bit = 1u8
        .checked_shl(u32::from(seat))
        .ok_or(ReztorError::MathOverflow)?;
    require!(
        match_account.joined_mask & seat_bit == 0,
        ReztorError::AlreadyJoined
    );

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.player_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        ),
        match_account.buy_in_amount,
        ctx.accounts.mint.decimals,
    )?;

    let match_account = &mut ctx.accounts.match_account;
    match_account.joined_mask |= seat_bit;
    emit!(PlayerJoined {
        match_id,
        seat,
        player,
    });

    if match_account.joined_mask == ALL_SEATS_JOINED {
        match_account.status = MatchStatus::Active;
        match_account.started_at = Clock::get()?.unix_timestamp;
        emit!(MatchStarted { match_id });
    }
    Ok(())
}
