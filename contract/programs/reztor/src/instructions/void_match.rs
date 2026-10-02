use anchor_lang::prelude::*;
use anchor_spl::token_interface::{close_account, CloseAccount, Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ReztorError,
    events::MatchVoided,
    math::{compute_void, SEAT_BITS},
    state::{Config, Match, CONFIG_SEED, MATCH_SEED, VAULT_SEED},
    utils::{transfer_from_vault, validate_seat_token_accounts},
};

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct VoidMatch<'info> {
    /// The authority (any time) or a seated, joined player (after the timeout). Pays only the fee.
    pub caller: Signer<'info>,
    /// CHECK: never read; it only receives rent, and its address is pinned to config.authority,
    /// which paid that rent at create_match. Need not sign.
    #[account(mut, address = config.authority @ ReztorError::Unauthorized)]
    pub authority: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [MATCH_SEED, &match_id.to_le_bytes()],
        bump = match_account.bump,
        has_one = mint @ ReztorError::InvalidMint,
        close = authority
    )]
    pub match_account: Account<'info, Match>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_SEED, match_account.key().as_ref()],
        bump = match_account.vault_bump,
        token::mint = mint,
        token::authority = match_account,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = config.treasury,
        token::token_program = token_program
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_void_match<'info>(
    ctx: Context<'info, VoidMatch<'info>>,
    match_id: u64,
) -> Result<()> {
    let accounts = &ctx.accounts;
    let token_program = accounts.token_program.key();
    let match_account = &accounts.match_account;
    let caller = accounts.caller.key();

    let by_authority = caller == accounts.config.authority;
    if !by_authority {
        let seat = match_account
            .seat_of(&caller)
            .ok_or(ReztorError::NotSeated)?;
        let seat_bit = SEAT_BITS
            .get(usize::from(seat))
            .ok_or(ReztorError::NotSeated)?;
        require!(
            match_account.joined_mask & seat_bit != 0,
            ReztorError::NotJoined
        );
        let deadline = match_account
            .created_at
            .checked_add(match_account.void_timeout_secs)
            .ok_or(ReztorError::MathOverflow)?;
        require!(
            Clock::get()?.unix_timestamp >= deadline,
            ReztorError::VoidTimeoutNotReached
        );
    }

    let joined_seats: Vec<u8> = (0u8..)
        .zip(SEAT_BITS)
        .filter(|(_, bit)| match_account.joined_mask & bit != 0)
        .map(|(seat, _)| seat)
        .collect();
    let seat_accounts = validate_seat_token_accounts(
        match_account,
        &token_program,
        &joined_seats,
        ctx.remaining_accounts,
    )?;

    let amounts = compute_void(
        match_account.buy_in_amount,
        match_account.joined_mask,
        accounts.vault.amount,
    )?;

    let match_id_bytes = match_id.to_le_bytes();
    let bump = [match_account.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[MATCH_SEED, &match_id_bytes, &bump]];
    let decimals = accounts.mint.decimals;

    let transfer = |to: AccountInfo<'info>, amount: u64| -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        transfer_from_vault(
            &token_program,
            accounts.vault.to_account_info(),
            accounts.mint.to_account_info(),
            to,
            match_account.to_account_info(),
            signer_seeds,
            amount,
            decimals,
        )
    };
    for (to, &seat) in seat_accounts.into_iter().zip(joined_seats.iter()) {
        let refund = amounts
            .refunds
            .get(usize::from(seat))
            .ok_or(ReztorError::MathOverflow)?;
        transfer(to, *refund)?;
    }
    transfer(accounts.treasury_token_account.to_account_info(), amounts.treasury)?;

    close_account(CpiContext::new_with_signer(
        token_program,
        CloseAccount {
            account: accounts.vault.to_account_info(),
            destination: accounts.authority.to_account_info(),
            authority: match_account.to_account_info(),
        },
        signer_seeds,
    ))?;

    emit!(MatchVoided {
        match_id,
        refunded_seats_mask: match_account.joined_mask,
        by_authority,
    });
    Ok(())
}
