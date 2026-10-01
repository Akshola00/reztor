use anchor_lang::prelude::*;
use anchor_spl::token_interface::{close_account, CloseAccount, Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ReztorError,
    events::MatchSettled,
    math::compute_settlement,
    state::{Config, Match, MatchStatus, CONFIG_SEED, MATCH_SEED, VAULT_SEED},
    utils::{transfer_from_vault, validate_seat_token_accounts},
};

const ALL_SEATS: [u8; 4] = [0, 1, 2, 3];

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct SettleMatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ReztorError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [MATCH_SEED, &match_id.to_le_bytes()],
        bump = match_account.bump,
        has_one = mint @ ReztorError::InvalidMint,
        constraint = match_account.status == MatchStatus::Active @ ReztorError::MatchNotActive,
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

pub fn handle_settle_match<'info>(
    ctx: Context<'info, SettleMatch<'info>>,
    match_id: u64,
    unspent_credits: [u32; 4],
    winners_mask: u8,
) -> Result<()> {
    let accounts = &ctx.accounts;
    let token_program = accounts.token_program.key();
    let match_account = &accounts.match_account;

    let seat_accounts = validate_seat_token_accounts(
        match_account,
        &token_program,
        &ALL_SEATS,
        ctx.remaining_accounts,
    )?;

    let amounts = compute_settlement(
        match_account.buy_in_amount,
        match_account.credits_per_buy_in,
        match_account.rake_bps,
        unspent_credits,
        winners_mask,
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
    for (to, &amount) in seat_accounts.into_iter().zip(amounts.payouts.iter()) {
        transfer(to, amount)?;
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

    emit!(MatchSettled {
        match_id,
        payouts: amounts.payouts,
        treasury_amount: amounts.treasury,
        winners_mask,
    });
    Ok(())
}
