use anchor_lang::prelude::*;

// Stub. Accounts and logic per contract-spec.md §3.
#[derive(Accounts)]
pub struct CreateMatch {}

pub fn handle_create_match(_ctx: Context<CreateMatch>) -> Result<()> {
    Ok(())
}
