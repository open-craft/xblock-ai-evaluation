"""Django admin for the AI Evaluation XBlocks."""

from django.contrib import admin

from .models import LearnerUpload


@admin.register(LearnerUpload)
class LearnerUploadAdmin(admin.ModelAdmin):
    """Read-only list of learner uploads, for operator queries. Files can't be downloaded from here."""

    list_display = ("upload_id", "user_id", "usage_key", "pane", "state", "size", "created")
    list_filter = ("pane", "state")
    search_fields = ("upload_id", "user_id", "usage_key")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
