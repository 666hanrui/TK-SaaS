class AutomationError(RuntimeError):
    code = "automation_error"


class RetryableAutomationError(AutomationError):
    code = "retryable_automation_error"


class ManualInterventionRequired(AutomationError):
    code = "manual_intervention_required"


class ConfigurationError(ManualInterventionRequired):
    code = "configuration_error"


class SkuMappingError(ManualInterventionRequired):
    code = "sku_mapping_error"
