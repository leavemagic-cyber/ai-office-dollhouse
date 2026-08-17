using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

internal static class AIOfficeHookRelay
{
    private const int MaxInputChars = 1048576;

    private static object GetValue(Dictionary<string, object> payload, params string[] names)
    {
        foreach (string name in names)
        {
            object value;
            if (payload.TryGetValue(name, out value) && value != null) return value;
        }
        return null;
    }

    private static string TextValue(Dictionary<string, object> payload, params string[] names)
    {
        object value = GetValue(payload, names);
        return value == null ? string.Empty : Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
    }

    private static string Hash(string value, int length)
    {
        using (SHA256 sha = SHA256.Create())
        {
            byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? string.Empty));
            StringBuilder output = new StringBuilder(bytes.Length * 2);
            foreach (byte item in bytes) output.Append(item.ToString("x2", CultureInfo.InvariantCulture));
            return output.ToString(0, Math.Min(length, output.Length));
        }
    }

    private static string Clip(string value, int maximum)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        string clean = value.Replace("\r", " ").Replace("\n", " ").Replace("<", string.Empty).Replace(">", string.Empty).Trim();
        return clean.Length <= maximum ? clean : clean.Substring(0, Math.Max(1, maximum - 3)) + "...";
    }

    private static long Timestamp(Dictionary<string, object> payload)
    {
        object raw = GetValue(payload, "timestamp");
        if (raw != null)
        {
            long numeric;
            if (long.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out numeric) && numeric > 100000000000L)
                return numeric;
            DateTimeOffset parsed;
            if (DateTimeOffset.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out parsed))
                return parsed.ToUnixTimeMilliseconds();
        }
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    private static string NormalizeHook(string value)
    {
        StringBuilder result = new StringBuilder();
        foreach (char character in value ?? string.Empty)
            if (char.IsLetterOrDigit(character)) result.Append(char.ToLowerInvariant(character));
        return result.ToString();
    }

    private static bool HasFailureDetails(Dictionary<string, object> payload)
    {
        string[] names = { "error", "error_message", "errorMessage", "failure_reason", "failureReason" };
        foreach (string name in names)
        {
            object value;
            if (!payload.TryGetValue(name, out value) || value == null) continue;
            if (value is bool)
            {
                if ((bool)value) return true;
                continue;
            }
            string text = Convert.ToString(value, CultureInfo.InvariantCulture);
            if (!string.IsNullOrWhiteSpace(text) &&
                !string.Equals(text, "false", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(text, "none", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(text, "null", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(text, "0", StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static bool TryBooleanValue(Dictionary<string, object> payload, out bool value, params string[] names)
    {
        object raw = GetValue(payload, names);
        if (raw is bool)
        {
            value = (bool)raw;
            return true;
        }
        string text = raw == null ? string.Empty : Convert.ToString(raw, CultureInfo.InvariantCulture);
        if (bool.TryParse(text, out value)) return true;
        if (string.Equals(text, "1", StringComparison.OrdinalIgnoreCase) || string.Equals(text, "yes", StringComparison.OrdinalIgnoreCase))
        {
            value = true;
            return true;
        }
        if (string.Equals(text, "0", StringComparison.OrdinalIgnoreCase) || string.Equals(text, "no", StringComparison.OrdinalIgnoreCase))
        {
            value = false;
            return true;
        }
        value = false;
        return false;
    }

    private static bool TryExitCode(Dictionary<string, object> payload, out int exitCode)
    {
        object raw = GetValue(payload, "exit_code", "exitCode");
        if (raw == null)
        {
            exitCode = 0;
            return false;
        }
        return int.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out exitCode);
    }

    private static string MapSubagentStop(Dictionary<string, object> payload)
    {
        // A stop hook alone is not evidence of a successful delivery.  Only
        // emit a terminal animation when the hook payload gives an outcome;
        // otherwise the office state will age out as unknown rather than lie.
        // An explicit cancellation is neutral even if a provider also includes
        // an error-shaped diagnostic field for that cancellation.
        string status = NormalizeHook(TextValue(payload, "status", "outcome", "result", "state", "stop_reason", "stopReason", "reason"));
        switch (status)
        {
            case "cancelled":
            case "canceled":
            case "aborted":
            case "interrupted":
            case "stopped":
            case "killed":
            case "terminated":
            case "cancel":
            case "abort":
            case "interrupt":
            case "stop":
            case "kill":
            case "terminate": return "agent_cancelled";
            case "success":
            case "succeeded":
            case "completed":
            case "complete":
            case "finished":
            case "done":
            case "ok": return "agent_finished";
            case "failed":
            case "failure":
            case "error":
            case "errored":
            case "timeout":
            case "timedout": return "agent_failed";
        }

        if (HasFailureDetails(payload)) return "agent_failed";

        bool success;
        if (TryBooleanValue(payload, out success, "success", "succeeded", "is_success", "isSuccess"))
            return success ? "agent_finished" : "agent_failed";

        int exitCode;
        if (TryExitCode(payload, out exitCode)) return exitCode == 0 ? "agent_finished" : "agent_failed";

        return string.Empty;
    }

    private static string MapEvent(string provider, string hook, Dictionary<string, object> payload)
    {
        switch (hook)
        {
            case "sessionstart": return "session_started";
            case "userpromptsubmit": return "turn_started";
            case "beforeagent": return "turn_started";
            case "stop":
                bool taskCompleted;
                if (TryBooleanValue(payload, out taskCompleted, "task_completed", "taskCompleted") && taskCompleted)
                    return "task_completed";
                string stopReason = NormalizeHook(TextValue(payload, "reason", "stop_reason", "stopReason"));
                return provider != "grok" || stopReason == "endturn" ? "turn_completed" : string.Empty;
            case "afteragent": return "turn_completed";
            case "sessionend": return "session_stopped";
            case "subagentstart": return "agent_spawned";
            case "subagentstop": return MapSubagentStop(payload);
            case "pretooluse": return "tool_started";
            case "beforetool": return "tool_started";
            case "posttooluse": return "tool_finished";
            case "aftertool": return "tool_finished";
            case "permissionrequest": return "owner_input_required";
            case "notification":
                string kind = TextValue(payload, "notification_type", "notificationType");
                if (Regex.IsMatch(kind, "^task[_ -]?completed$", RegexOptions.IgnoreCase)) return "task_completed";
                return kind.IndexOf("permission", StringComparison.OrdinalIgnoreCase) >= 0 || kind.IndexOf("elicitation", StringComparison.OrdinalIgnoreCase) >= 0
                    ? "owner_input_required" : string.Empty;
            default: return string.Empty;
        }
    }

    private static string SourceEvidence(string eventType)
    {
        switch (eventType)
        {
            case "agent_spawned": return "hook:subagent_started";
            case "agent_finished": return "hook:subagent_finished";
            case "agent_failed": return "hook:subagent_failed";
            case "agent_cancelled": return "hook:subagent_cancelled";
            case "task_completed": return "hook:task_completed";
            case "owner_input_required": return "hook:owner_input_required";
            default: return "hook:lifecycle";
        }
    }

    private static void AppendWithRetry(string path, string line)
    {
        for (int attempt = 0; attempt < 4; attempt++)
        {
            try
            {
                using (FileStream stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false)))
                {
                    writer.WriteLine(line);
                    return;
                }
            }
            catch (IOException)
            {
                if (attempt == 3) return;
                Thread.Sleep(15 * (attempt + 1));
            }
        }
    }

    private static void Run(string provider, string surfaceKind)
    {
        if (provider == "claude" && !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("GROK_HOOK_EVENT"))) return;
        string raw;
        // Grok writes one compact JSON record plus a newline, then keeps the child's
        // stdin pipe open while waiting for the hook to exit. ReadToEnd therefore
        // deadlocked until Grok's timeout killed the relay. Every supported provider's
        // hook payload is one JSON record, so a line read works with both newline and EOF.
        using (StreamReader reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8, true, 4096, false)) raw = reader.ReadLine();
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > MaxInputChars) return;

        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = MaxInputChars;
        Dictionary<string, object> payload = serializer.Deserialize<Dictionary<string, object>>(raw);
        if (payload == null) return;

        string hookRaw = TextValue(payload, "hook_event_name", "hookEventName");
        if (string.IsNullOrWhiteSpace(hookRaw)) hookRaw = Environment.GetEnvironmentVariable("GROK_HOOK_EVENT") ?? string.Empty;
        string hook = NormalizeHook(hookRaw);
        string eventType = MapEvent(provider, hook, payload);
        string rawSession = TextValue(payload, "session_id", "sessionId");
        if (string.IsNullOrWhiteSpace(eventType) || string.IsNullOrWhiteSpace(rawSession)) return;

        string rawAgent = TextValue(payload, "agent_id", "agentId", "agent_name", "agentName");
        string rawTurn = TextValue(payload, "turn_id", "turnId", "tool_use_id", "toolUseId");
        string rawTool = TextValue(payload, "tool_name", "toolName");
        string rawRole = TextValue(payload, "agent_type", "agentType", "agent_name", "agentName");
        string rawCwd = TextValue(payload, "cwd", "workspaceRoot");
        long timestamp = Timestamp(payload);
        string sessionId = Hash(provider + ":" + rawSession, 24);
        string agentId = string.IsNullOrWhiteSpace(rawAgent) ? null : Hash(provider + ":" + rawSession + ":" + rawAgent, 24);
        string parentAgentId = eventType == "agent_spawned" ? "main:" + sessionId : null;
        string safeLabel = "Unnamed work";
        if (!string.IsNullOrWhiteSpace(rawCwd))
        {
            string trimmed = rawCwd.TrimEnd('\\', '/');
            safeLabel = Path.GetFileName(trimmed);
            if (string.IsNullOrWhiteSpace(safeLabel)) safeLabel = "Unnamed work";
        }
        safeLabel = Clip(safeLabel, 42);
        string surface = surfaceKind == "auto" ? "unknown" : surfaceKind.ToLowerInvariant();
        string eventId = Hash(string.Join("|", provider, rawSession, hook, rawAgent, rawTurn, rawTool, timestamp.ToString(CultureInfo.InvariantCulture)), 32);

        Dictionary<string, object> officeEvent = new Dictionary<string, object>();
        officeEvent["schemaVersion"] = 1;
        officeEvent["eventId"] = eventId;
        officeEvent["timestamp"] = timestamp;
        officeEvent["provider"] = provider;
        officeEvent["surfaceId"] = provider + ":" + surface;
        officeEvent["surfaceKind"] = surface;
        officeEvent["sessionId"] = sessionId;
        officeEvent["agentId"] = agentId;
        officeEvent["parentAgentId"] = parentAgentId;
        officeEvent["eventType"] = eventType;
        officeEvent["taskLabel"] = safeLabel;
        officeEvent["role"] = Clip(rawRole, 24);
        officeEvent["toolName"] = Clip(rawTool, 30);
        officeEvent["observationTier"] = "A";
        officeEvent["sourceConfidence"] = "structured";
        officeEvent["sourceEvidence"] = SourceEvidence(eventType);
        officeEvent["important"] = eventType == "owner_input_required" || eventType == "task_completed" || eventType == "session_stopped" || eventType == "agent_failed";

        string dataDirectory = Environment.GetEnvironmentVariable("AI_OFFICE_DATA_DIR");
        if (string.IsNullOrWhiteSpace(dataDirectory)) dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AIOfficeDollhouse");
        Directory.CreateDirectory(dataDirectory);
        string eventPath = Path.Combine(dataDirectory, "events.ndjson");
        if (File.Exists(eventPath) && new FileInfo(eventPath).Length > 2097152)
        {
            string archivePath = Path.Combine(dataDirectory, "events.1.ndjson");
            if (File.Exists(archivePath)) File.Delete(archivePath);
            File.Move(eventPath, archivePath);
        }
        string serialized = serializer.Serialize(officeEvent);
        AppendWithRetry(eventPath, serialized);
        // A bounded live inbox keeps desktop polling independent from the full audit
        // ledger. Preserve one prior segment so a session start survives rotation.
        string livePath = Path.Combine(dataDirectory, "live-events.ndjson");
        if (File.Exists(livePath) && new FileInfo(livePath).Length > 524288)
        {
            string liveArchive = Path.Combine(dataDirectory, "live-events.1.ndjson");
            if (File.Exists(liveArchive)) File.Delete(liveArchive);
            File.Move(livePath, liveArchive);
        }
        AppendWithRetry(livePath, serialized);
    }

    public static int Main(string[] args)
    {
        try
        {
            string provider = args.Length > 0 ? args[0].ToLowerInvariant() : string.Empty;
            string surface = args.Length > 1 ? args[1].ToLowerInvariant() : "auto";
            if (provider == "codex" || provider == "claude" || provider == "gemini" || provider == "grok") Run(provider, surface);
        }
        catch
        {
            // Observability hooks always fail open and never print raw payloads.
        }
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.Write("{}");
        return 0;
    }
}
