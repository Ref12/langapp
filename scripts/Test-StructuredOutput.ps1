#requires -Version 7.0
<#
.SYNOPSIS
Tests observed JSON-schema compliance for a Chat Completions or Responses API.
.DESCRIPTION
Sends one synthetic, potentially billable request. A random value appears only
in the schema, while the prompt requests plain text. This detects endpoints that
accept but ignore the schema parameter. Passing demonstrates compliance for this
request, not a guarantee of the provider's enforcement mechanism or future replies.

Writes a JSON report. Exit codes: 0 = conforming, 1 = completed but nonconforming,
2 = inconclusive (configuration, transport, refusal, truncation, or API failure).
No retries, protocol fallback, workspace reads, or saved settings changes.
.PARAMETER Url
API root (usually ending in /v1), or a full /responses or /chat/completions URL.
HTTPS is required except on localhost. Query strings and embedded credentials
are not accepted, and redirects are never followed.
.PARAMETER ApiKey
Provider key. Defaults to OPENAI_API_KEY. Prefer the environment variable or a
PowerShell variable over typing a literal key into shell history.
.PARAMETER Model
Exact model identifier. Required because schema support is model-specific.
.PARAMETER ApiType
responses or chat-completions. Inferred from a full operation URL; otherwise
defaults to responses. An explicit choice must agree with a full operation URL.
.PARAMETER TimeoutSeconds
Deadline for the complete request, including reading the response body.
.PARAMETER MaxOutputTokens
Output budget, including reasoning where applicable. Truncation is inconclusive.
.EXAMPLE
.\scripts\Test-StructuredOutput.ps1 -Url https://api.openai.com/v1 -Model YOUR_MODEL
.EXAMPLE
.\scripts\Test-StructuredOutput.ps1 -Url $url -ApiKey $key -Model $model -ApiType chat-completions
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Url,
    [string]$ApiKey = $env:OPENAI_API_KEY,
    [Parameter(Mandatory)][string]$Model,
    [ValidateSet('responses', 'chat-completions')][string]$ApiType,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 60,
    [ValidateRange(128, 16000)][int]$MaxOutputTokens = 2048
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Endpoint = $null
$script:Protocol = $null
$script:HttpStatus = $null
$script:Accepted = $false

function Finish-Probe([string]$Result, [string]$Detail) {
    $conformant = $null
    $code = 2
    if ($Result -eq 'pass') { $conformant = $true; $code = 0 }
    if ($Result -eq 'nonconforming') { $conformant = $false; $code = 1 }
    [ordered]@{
        result = $Result
        apiType = $script:Protocol
        endpoint = $script:Endpoint
        model = $Model
        httpStatus = $script:HttpStatus
        requestAccepted = $script:Accepted
        schemaConformant = $conformant
        detail = $Detail
    } | ConvertTo-Json -Depth 5
    exit $code
}

function Get-CompletionText([System.Collections.IDictionary]$Envelope) {
    if ($script:Protocol -eq 'chat-completions') {
        $choices = $Envelope['choices']
        if ($choices -isnot [array] -or $choices.Count -ne 1 -or $choices[0] -isnot [System.Collections.IDictionary]) {
            Finish-Probe 'inconclusive' 'The endpoint did not return a supported Chat Completions envelope.'
        }
        $choice = $choices[0]
        if ($choice['finish_reason'] -ceq 'length') {
            Finish-Probe 'inconclusive' 'The reply was truncated. Increase -MaxOutputTokens or use a less reasoning-intensive model.'
        }
        $message = $choice['message']
        if ($choice['finish_reason'] -cne 'stop' -or $message -isnot [System.Collections.IDictionary]) {
            Finish-Probe 'inconclusive' 'The model did not complete a normal reply.'
        }
        if ($message['refusal'] -or $message['tool_calls']) {
            Finish-Probe 'inconclusive' 'The model refused or requested tools instead of completing the schema probe.'
        }
        if ($message['role'] -cne 'assistant' -or $message['content'] -isnot [string]) {
            Finish-Probe 'inconclusive' 'The endpoint did not return an assistant text reply.'
        }
        return $message['content']
    }

    if ($Envelope['status'] -ceq 'incomplete') {
        Finish-Probe 'inconclusive' 'The Responses request was incomplete. Check model limits or increase -MaxOutputTokens.'
    }
    if ($Envelope['status'] -cne 'completed' -or $Envelope['error'] -or $Envelope['incomplete_details']) {
        Finish-Probe 'inconclusive' 'The Responses request did not complete successfully.'
    }
    $items = $Envelope['output']
    if ($items -isnot [array] -or $items.Count -gt 48) {
        Finish-Probe 'inconclusive' 'The endpoint did not return a supported Responses output array.'
    }
    $text = [System.Text.StringBuilder]::new()
    foreach ($item in $items) {
        if ($item -isnot [System.Collections.IDictionary]) {
            Finish-Probe 'inconclusive' 'The endpoint returned a malformed output item.'
        }
        if ($item.Contains('status') -and $item['status'] -cne 'completed') {
            Finish-Probe 'inconclusive' 'The endpoint returned unfinished output.'
        }
        if ($item['type'] -ceq 'reasoning') { continue }
        if ($item['type'] -cne 'message' -or $item['role'] -cne 'assistant' -or $item['status'] -cne 'completed' -or $item['content'] -isnot [array]) {
            Finish-Probe 'inconclusive' 'The endpoint returned unsupported output instead of a completed assistant message.'
        }
        foreach ($part in $item['content']) {
            if ($part -isnot [System.Collections.IDictionary] -or $part['type'] -cne 'output_text' -or $part['text'] -isnot [string]) {
                Finish-Probe 'inconclusive' 'The model refused or returned non-text content.'
            }
            if ($item['phase'] -cne 'commentary') { [void]$text.Append($part['text']) }
        }
    }
    if ($text.Length -eq 0) { Finish-Probe 'inconclusive' 'The endpoint returned no final text to evaluate.' }
    return $text.ToString()
}

$handler = $null
$client = $null
$request = $null
$response = $null
$deadline = $null
$stream = $null
$buffered = $null
$document = $null
try {
    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.Host -in @('localhost', '127.0.0.1', '[::1]')))) {
        Finish-Probe 'inconclusive' 'Use an HTTPS API URL, or HTTP on localhost, without query parameters, fragments, or embedded credentials.'
    }
    if ([string]::IsNullOrWhiteSpace($ApiKey) -or $ApiKey.Length -gt 4000) {
        Finish-Probe 'inconclusive' 'Supply -ApiKey or set OPENAI_API_KEY. No request was sent.'
    }
    if ([string]::IsNullOrWhiteSpace($Model) -or $Model.Length -gt 200) {
        Finish-Probe 'inconclusive' 'Supply a valid model identifier. No request was sent.'
    }
    $path = $uri.AbsolutePath.TrimEnd('/')
    $inferred = if ($path.EndsWith('/chat/completions')) { 'chat-completions' } elseif ($path.EndsWith('/responses')) { 'responses' } else { $null }
    if ($inferred -and $ApiType -and $inferred -ne $ApiType) {
        Finish-Probe 'inconclusive' '-ApiType conflicts with the operation in -Url. No request was sent.'
    }
    $script:Protocol = if ($ApiType) { $ApiType } elseif ($inferred) { $inferred } else { 'responses' }
    $suffix = if ($script:Protocol -eq 'responses') { 'responses' } else { 'chat/completions' }
    $script:Endpoint = if ($inferred) { $uri.AbsoluteUri.TrimEnd('/') } else { $uri.AbsoluteUri.TrimEnd('/') + '/' + $suffix }

    # The random proof is supplied only through the schema, never in the prompt.
    $proof = [Guid]::NewGuid().ToString('N')
    $schema = @{
        type = 'object'
        additionalProperties = $false
        required = @('proof', 'count', 'status')
        properties = @{
            proof = @{ type = 'string'; enum = @($proof) }
            count = @{ type = 'integer'; enum = @(7) }
            status = @{ type = 'string'; enum = @('schema_applied') }
        }
    }
    $messages = @(
        @{ role = 'system'; content = 'Follow the API response-format contract when one is supplied.' },
        @{ role = 'user'; content = 'Reply with the single plain-text word UNSTRUCTURED. Do not produce JSON, keys, or any other text.' }
    )
    $format = @{ name = 'structured_output_probe'; strict = $true; schema = $schema }
    $body = @{ model = $Model; stream = $false; store = $false }
    if ($script:Protocol -eq 'responses') {
        $body.input = $messages
        $body.max_output_tokens = $MaxOutputTokens
        $body.text = @{ format = @{ type = 'json_schema'; name = $format.name; strict = $true; schema = $schema } }
    } else {
        $body.messages = $messages
        $body.max_tokens = $MaxOutputTokens
        $body.response_format = @{ type = 'json_schema'; json_schema = $format }
    }
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseCookies = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
    $deadline = [System.Threading.CancellationTokenSource]::new()
    $deadline.CancelAfter([TimeSpan]::FromSeconds($TimeoutSeconds))
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $script:Endpoint)
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $ApiKey)
    $request.Content = [System.Net.Http.StringContent]::new(($body | ConvertTo-Json -Depth 15 -Compress), [System.Text.Encoding]::UTF8, 'application/json')
    $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
    $script:HttpStatus = [int]$response.StatusCode
    if (-not $response.IsSuccessStatusCode) {
        $detail = switch ($script:HttpStatus) {
            { $_ -in @(401, 403) } { 'Authentication or model access was rejected.'; break }
            429 { 'The provider is rate limited or out of quota.'; break }
            { $_ -ge 300 -and $_ -lt 400 } { 'The endpoint redirected. Use its final URL; redirects are not followed.'; break }
            { $_ -in @(400, 404, 422) } { 'The provider rejected the request. Check the API type, model, schema support, URL, and token-limit parameters.'; break }
            default { 'The provider returned an HTTP error. No capability conclusion can be drawn.' }
        }
        Finish-Probe 'inconclusive' $detail
    }
    $script:Accepted = $true
    $maxBytes = 256 * 1024
    if ($response.Content.Headers.ContentLength -gt $maxBytes) {
        Finish-Probe 'inconclusive' 'The provider response exceeded the 256 KiB safety limit.'
    }
    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $buffered = [System.IO.MemoryStream]::new()
    $buffer = [byte[]]::new(8192)
    while (($read = $stream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()) -gt 0) {
        if ($buffered.Length + $read -gt $maxBytes) {
            Finish-Probe 'inconclusive' 'The provider response exceeded the 256 KiB safety limit.'
        }
        $buffered.Write($buffer, 0, $read)
    }
    try {
        $raw = [System.Text.UTF8Encoding]::new($false, $true).GetString($buffered.ToArray())
        $envelope = ConvertFrom-Json -InputObject $raw -AsHashtable -Depth 50
    } catch {
        Finish-Probe 'inconclusive' 'The provider returned an invalid JSON API envelope. Response details were not displayed.'
    }
    if ($envelope -isnot [System.Collections.IDictionary]) {
        Finish-Probe 'inconclusive' 'The provider returned an invalid API envelope.'
    }
    $reply = Get-CompletionText $envelope
    try {
        $document = [System.Text.Json.JsonDocument]::Parse([string]$reply)
    } catch {
        Finish-Probe 'nonconforming' 'The completed reply was not strict JSON. The schema was not honored in this probe.'
    }
    $root = $document.RootElement
    if ($root.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        Finish-Probe 'nonconforming' 'The reply did not match the required object schema.'
    }
    $properties = @($root.EnumerateObject())
    $names = @($properties | ForEach-Object { $_.Name })
    if ($properties.Count -ne 3 -or $names -cnotcontains 'proof' -or $names -cnotcontains 'count' -or $names -cnotcontains 'status') {
        Finish-Probe 'nonconforming' 'The reply contained missing, extra, duplicated, or incorrectly named fields.'
    }
    $proofValue = $root.GetProperty('proof')
    $countValue = $root.GetProperty('count')
    $statusValue = $root.GetProperty('status')
    if ($proofValue.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $proofValue.GetString() -cne $proof -or
        $countValue.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or $countValue.GetDouble() -ne 7 -or
        $statusValue.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $statusValue.GetString() -cne 'schema_applied') {
        Finish-Probe 'nonconforming' 'The reply violated a schema type or enum constraint, including the proof supplied only in the schema.'
    }
    Finish-Probe 'pass' 'The completed reply matched every schema constraint. This demonstrates observed compliance, not a guarantee of provider enforcement or future replies.'
} catch {
    if ($null -ne $deadline -and $deadline.IsCancellationRequested) {
        Finish-Probe 'inconclusive' 'The request timed out, including response-body reading. No capability conclusion can be drawn.'
    }
    Finish-Probe 'inconclusive' 'The probe could not complete. Check the URL, key, network, and TLS configuration. Error details were suppressed to protect credentials.'
} finally {
    if ($null -ne $document) { $document.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -ne $buffered) { $buffered.Dispose() }
    if ($null -ne $response) { $response.Dispose() }
    if ($null -ne $request) { $request.Dispose() }
    if ($null -ne $client) { $client.Dispose() } elseif ($null -ne $handler) { $handler.Dispose() }
    if ($null -ne $deadline) { $deadline.Dispose() }
}
