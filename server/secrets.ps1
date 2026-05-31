# Set Worker secrets via local Wrangler 3 (Node 18+)
param(
  [ValidateSet("supabase-url", "supabase-key", "image-key", "image-base", "chat-key", "admin", "all")]
  [string]$Which = "all"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path "node_modules\wrangler")) { npm install }

function Put-Secret([string]$name) {
  Write-Host "wrangler secret put $name"
  npm exec wrangler secret put $name
}

switch ($Which) {
  "supabase-url" { Put-Secret "SUPABASE_URL" }
  "supabase-key" { Put-Secret "SUPABASE_SERVICE_ROLE_KEY" }
  "image-key"    { Put-Secret "IMAGE_API_KEY" }
  "image-base"   { Put-Secret "IMAGE_API_BASE_URL" }
  "chat-key"     { Put-Secret "CHAT_API_KEY" }
  "admin"        { Put-Secret "ADMIN_API_SECRET" }
  "all" {
    Put-Secret "SUPABASE_URL"
    Put-Secret "SUPABASE_SERVICE_ROLE_KEY"
    Put-Secret "IMAGE_API_KEY"
    Put-Secret "IMAGE_API_BASE_URL"
    Put-Secret "CHAT_API_KEY"
  }
}

Write-Host "Done. Run: npm run deploy  or  .\deploy.ps1"
Write-Host "Tip: use secret-supabase not secret:supabase (colon breaks on Windows)"
