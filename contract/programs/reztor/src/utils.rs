use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TokenAccount, TransferChecked};

use crate::{errors::ReztorError, state::Match};

/// contract-spec.md §4. Checks that `remaining_accounts` holds exactly one token account per
/// entry in `seats`, in that order, each owned (token owner) by that seat's player and holding
/// the match's mint. Returns them in seat order.
pub fn validate_seat_token_accounts<'info>(
    match_account: &Match,
    token_program: &Pubkey,
    seats: &[u8],
    remaining_accounts: &'info [AccountInfo<'info>],
) -> Result<Vec<AccountInfo<'info>>> {
    require!(
        remaining_accounts.len() == seats.len(),
        ReztorError::WrongRemainingAccountsCount
    );

    let mut validated = Vec::with_capacity(seats.len());
    for (&seat, info) in seats.iter().zip(remaining_accounts.iter()) {
        let player = match_account
            .players
            .get(usize::from(seat))
            .ok_or(ReztorError::NotSeated)?;

        require!(info.is_writable, ReztorError::InvalidTokenAccount);
        require_keys_eq!(*info.owner, *token_program, ReztorError::InvalidTokenAccount);
        let token_account = {
            let data = info.try_borrow_data()?;
            TokenAccount::try_deserialize(&mut &data[..])
                .map_err(|_| error!(ReztorError::InvalidTokenAccount))?
        };
        require_keys_eq!(token_account.mint, match_account.mint, ReztorError::InvalidTokenAccount);
        require_keys_eq!(token_account.owner, *player, ReztorError::InvalidTokenAccount);

        validated.push(info.clone());
    }
    Ok(validated)
}

/// transfer_checked out of a match vault, signed by the Match PDA.
#[allow(clippy::too_many_arguments)]
pub fn transfer_from_vault<'info>(
    token_program: &Pubkey,
    vault: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    match_account: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    transfer_checked(
        CpiContext::new_with_signer(
            *token_program,
            TransferChecked {
                from: vault,
                mint,
                to,
                authority: match_account,
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}
