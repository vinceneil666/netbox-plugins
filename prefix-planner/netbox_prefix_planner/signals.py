from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import CustomerProvisioning


@receiver(post_save, sender=CustomerProvisioning)
def enqueue_provisioning(sender, instance, created, **kwargs):
    """Kick off the provisioning job when a new customer is entered."""
    if not created:
        return
    from .jobs import ProvisionCustomerJob

    # Enqueue after commit so the worker can see the new row
    transaction.on_commit(lambda: ProvisionCustomerJob.enqueue(instance=instance))
