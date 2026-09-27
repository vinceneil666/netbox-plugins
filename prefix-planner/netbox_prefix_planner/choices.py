from utilities.choices import ChoiceSet


class ProvisioningStatusChoices(ChoiceSet):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

    CHOICES = [
        (PENDING, "Pending", "cyan"),
        (RUNNING, "Running", "blue"),
        (COMPLETED, "Completed", "green"),
        (FAILED, "Failed", "red"),
    ]
