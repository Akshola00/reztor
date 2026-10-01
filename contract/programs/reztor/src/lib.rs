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

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        instructions::initialize_config::handle_initialize_config(ctx)
    }

    pub fn update_config(ctx: Context<UpdateConfig>) -> Result<()> {
        instructions::update_config::handle_update_config(ctx)
    }

    pub fn create_match(ctx: Context<CreateMatch>) -> Result<()> {
        instructions::create_match::handle_create_match(ctx)
    }

    pub fn join_match(ctx: Context<JoinMatch>) -> Result<()> {
        instructions::join_match::handle_join_match(ctx)
    }

    pub fn settle_match(ctx: Context<SettleMatch>) -> Result<()> {
        instructions::settle_match::handle_settle_match(ctx)
    }

    pub fn void_match(ctx: Context<VoidMatch>) -> Result<()> {
        instructions::void_match::handle_void_match(ctx)
    }
}
