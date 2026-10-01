use anchor_lang::prelude::*;

// Stub. Accounts and logic per contract-spec.md §3.
#[derive(Accounts)]
pub struct JoinMatch {}

pub fn handle_join_match(_ctx: Context<JoinMatch>) -> Result<()> {
    Ok(())
}
