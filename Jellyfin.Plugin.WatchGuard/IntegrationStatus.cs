using System.Reflection;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record RegistrationStatus(bool InjectorDiscovered, bool InterfaceCompatible, bool RegistrationSucceeded,
    string? ScriptVersion, string State);
public sealed class IntegrationStatus
{
    private RegistrationStatus snapshot = new(false, false, false, null, "Waiting for registration");
    public RegistrationStatus Snapshot => Volatile.Read(ref snapshot);
    public void Set(RegistrationStatus value) => Volatile.Write(ref snapshot, value);
    public static MethodInfo? RegistrationMethod(Type? type) => type?.GetMethods(BindingFlags.Public | BindingFlags.Static)
        .FirstOrDefault(m => m.Name == "RegisterScript" && m.ReturnType == typeof(bool) &&
            m.GetParameters() is [{ ParameterType.FullName: "Newtonsoft.Json.Linq.JObject" }]);
}
