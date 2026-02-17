-- Add swap_processes_json column to command_responses table
-- for get-swap-processes command responses
ALTER TABLE command_responses
ADD COLUMN IF NOT EXISTS swap_processes_json TEXT;
