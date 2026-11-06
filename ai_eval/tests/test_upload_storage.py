"""Tests for the learner upload storage and table functions."""

import codecs
import hashlib
import io
import uuid
from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
import time_machine
from django.core.files.storage import InMemoryStorage, default_storage
from django.core.management import call_command
from django.db import DatabaseError
from django.utils import timezone
from pypdf import PdfWriter

from ai_eval import upload_storage
from ai_eval.models import LearnerUpload
from ai_eval.upload_storage import UploadNotFound, UploadRejected

COURSE_KEY = "course-v1:OpenCraft+AI101+2026"
USAGE_KEY = "block-v1:OpenCraft+AI101+2026+type@shortanswer_ai_eval+block@first"
OTHER_USAGE_KEY = "block-v1:OpenCraft+AI101+2026+type@shortanswer_ai_eval+block@second"
LEARNER_ID = 7
OTHER_LEARNER_ID = 8


def make_pdf_bytes(page_count=1, password=None):
    """Return the bytes of a PDF with ``page_count`` blank pages, optionally encrypted."""
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=72, height=72)
    if password is not None:
        writer.encrypt(password)
    pdf_buffer = io.BytesIO()
    writer.write(pdf_buffer)
    return pdf_buffer.getvalue()


def save_test_upload(
    *, user_id=LEARNER_ID, course_key=COURSE_KEY, usage_key=USAGE_KEY, pane="shortanswer",
    filename="notes.txt", file_bytes=b"my notes",
):
    """Save an upload with sensible defaults for the fields a test doesn't care about."""
    return upload_storage.save_upload(
        user_id=user_id,
        anonymous_user_id="anonymous-learner",
        course_key=course_key,
        usage_key=usage_key,
        pane=pane,
        filename=filename,
        file_bytes=file_bytes,
        content_type="text/plain",
    )


def mark_test_upload_sent(upload):
    """Mark one upload as sent and return it refreshed from the database."""
    upload_storage.mark_sent([str(upload.upload_id)])
    upload.refresh_from_db()
    return upload


def test_get_upload_storage_uses_named_alias(settings):
    """An operator-defined ``ai_eval_uploads`` storage is used instead of the default."""
    settings.STORAGES = {
        **settings.STORAGES,
        upload_storage.STORAGE_ALIAS: {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    }

    storage = upload_storage.get_upload_storage()

    assert isinstance(storage, InMemoryStorage)
    assert storage is not default_storage._wrapped  # pylint: disable=protected-access


def test_get_upload_storage_falls_back_to_default():
    """Without an ``ai_eval_uploads`` storage, uploads go to the default storage."""
    assert upload_storage.get_upload_storage() is default_storage


def test_validate_rejects_unknown_extension():
    """Only PDF, TXT, MD and CSV files are accepted."""
    with pytest.raises(UploadRejected) as rejection:
        upload_storage.validate_and_read(io.BytesIO(b"text"), "essay.docx", 4)

    assert rejection.value.code == "unsupported_type"


@pytest.mark.parametrize("filename, content_length", [
    ("big.pdf", upload_storage.PDF_MAX_BYTES + 1),
    ("big.txt", upload_storage.TEXT_MAX_BYTES + 1),
    ("unknown-size.txt", None),
])
def test_validate_rejects_content_length_over_limit_without_reading(filename, content_length):
    """A missing or oversized Content-Length is rejected before the body is read."""
    stream = Mock()

    with pytest.raises(UploadRejected) as rejection:
        upload_storage.validate_and_read(stream, filename, content_length)

    assert rejection.value.code == "file_too_large"
    stream.read.assert_not_called()


def test_validate_rejects_body_longer_than_header():
    """A body longer than the limit is rejected even when the header claims it's small."""
    oversized_body = io.BytesIO(b"a" * (upload_storage.TEXT_MAX_BYTES + 10))

    with pytest.raises(UploadRejected) as rejection:
        upload_storage.validate_and_read(oversized_body, "notes.txt", 10)

    assert rejection.value.code == "file_too_large"


def test_validate_rejects_pdf_extension_with_non_pdf_bytes():
    """A file named ``.pdf`` must actually be a PDF."""
    with pytest.raises(UploadRejected) as rejection:
        upload_storage.validate_and_read(io.BytesIO(b"plain text"), "report.pdf", 10)

    assert rejection.value.code == "unsupported_type"


def test_validate_rejects_non_utf8_text():
    """Text files must be UTF-8."""
    latin1_text = "café".encode("latin-1")

    with pytest.raises(UploadRejected) as rejection:
        upload_storage.validate_and_read(io.BytesIO(latin1_text), "notes.md", len(latin1_text))

    assert rejection.value.code == "unsupported_type"


def test_validate_strips_utf8_bom():
    """A UTF-8 byte order mark is removed and the content type comes from the extension."""
    text_with_bom = codecs.BOM_UTF8 + "a,b\n1,2".encode()

    file_bytes, content_type = upload_storage.validate_and_read(
        io.BytesIO(text_with_bom), "Table.CSV", len(text_with_bom),
    )

    assert file_bytes == b"a,b\n1,2"
    assert content_type == "text/csv"


def test_validate_accepts_pdf_at_page_limit():
    """A PDF with exactly the maximum number of pages is accepted unchanged."""
    pdf_bytes = make_pdf_bytes(page_count=upload_storage.PDF_MAX_PAGES)

    file_bytes, content_type = upload_storage.validate_and_read(io.BytesIO(pdf_bytes), "book.pdf", len(pdf_bytes))

    assert file_bytes == pdf_bytes
    assert content_type == "application/pdf"


def test_validate_rejects_pdf_over_page_limit():
    """A PDF with more than the maximum number of pages is rejected."""
    pdf_bytes = make_pdf_bytes(page_count=upload_storage.PDF_MAX_PAGES + 1)

    with pytest.raises(UploadRejected) as rejection:
        upload_storage.validate_and_read(io.BytesIO(pdf_bytes), "book.pdf", len(pdf_bytes))

    assert rejection.value.code == "too_many_pages"


@pytest.mark.parametrize("pdf_bytes", [
    b"%PDF-1.7\nnot really a pdf",
    make_pdf_bytes(password="secret"),
    make_pdf_bytes(password=""),
], ids=["corrupt", "encrypted", "encrypted-with-empty-password"])
def test_validate_rejects_corrupt_and_encrypted_pdf(pdf_bytes):
    """PDFs that can't be read, or that are encrypted, are rejected."""
    with pytest.raises(UploadRejected) as rejection:
        upload_storage.validate_and_read(io.BytesIO(pdf_bytes), "report.pdf", len(pdf_bytes))

    assert rejection.value.code == "unsupported_type"


@pytest.mark.django_db
def test_save_upload_writes_object_and_pending_row():
    """The bytes are stored under the anonymous user ID and a pending row records them."""
    upload_id = uuid.uuid4()

    with patch("ai_eval.upload_storage.uuid.uuid4", return_value=upload_id):
        upload = save_test_upload(file_bytes=b"my notes")

    assert upload.storage_path == (
        f"ai_eval/uploads/{COURSE_KEY}/{USAGE_KEY}/anonymous-learner/{upload_id}/notes.txt"
    )
    assert upload.upload_id == upload_id
    assert upload.state == LearnerUpload.State.PENDING
    assert upload.size == len(b"my notes")
    assert upload.sha256 == hashlib.sha256(b"my notes").hexdigest()
    assert upload_storage.read_upload_bytes(str(upload_id)) == b"my notes"


@pytest.mark.django_db
def test_save_upload_sanitizes_storage_name_keeps_display_name():
    """The storage path uses a safe filename, while the row keeps the original for display."""
    upload = save_test_upload(filename="My Essay (final).txt")

    assert upload.storage_path.endswith("/My_Essay_final.txt")
    assert upload.filename == "My Essay (final).txt"


@pytest.mark.django_db
def test_save_upload_removes_object_if_row_insert_fails():
    """If the row can't be inserted, the stored object is deleted again."""
    upload_id = uuid.uuid4()
    expected_path = f"ai_eval/uploads/{COURSE_KEY}/{USAGE_KEY}/anonymous-learner/{upload_id}/notes.txt"

    with (
        patch("ai_eval.upload_storage.uuid.uuid4", return_value=upload_id),
        patch.object(LearnerUpload.objects, "create", side_effect=DatabaseError),
        pytest.raises(DatabaseError),
    ):
        save_test_upload()

    assert not default_storage.exists(expected_path)


@pytest.mark.django_db
def test_count_pending_scoped_to_user_block_pane():
    """Only the learner's pending uploads in this block and pane are counted."""
    save_test_upload(pane="workspace")
    save_test_upload(pane="workspace")
    mark_test_upload_sent(save_test_upload(pane="workspace"))
    save_test_upload(pane="coach")
    save_test_upload(pane="workspace", usage_key=OTHER_USAGE_KEY)
    save_test_upload(pane="workspace", user_id=OTHER_LEARNER_ID)

    assert upload_storage.count_pending(LEARNER_ID, USAGE_KEY, "workspace") == 2


@pytest.mark.django_db
def test_count_pending_ignores_rows_past_ttl():
    """Pending uploads older than the TTL no longer take a slot."""
    with time_machine.travel(timezone.now() - upload_storage.PENDING_TTL - timedelta(minutes=1)):
        save_test_upload()
    save_test_upload()

    assert upload_storage.count_pending(LEARNER_ID, USAGE_KEY, "shortanswer") == 1


@pytest.mark.django_db
def test_delete_pending_uploads_in_block_older_than_deletes_old_pending_only():
    """The purge deletes abandoned pending uploads, but keeps recent and sent ones."""
    with time_machine.travel(timezone.now() - upload_storage.PENDING_TTL - timedelta(minutes=1)):
        old_pending_upload = save_test_upload()
        old_sent_upload = mark_test_upload_sent(save_test_upload())
    recent_pending_upload = save_test_upload()

    deleted_count = upload_storage.delete_pending_uploads_in_block(
        LEARNER_ID, USAGE_KEY, older_than=upload_storage.PENDING_TTL,
    )

    assert deleted_count == 1
    assert not LearnerUpload.objects.filter(pk=old_pending_upload.pk).exists()
    assert not default_storage.exists(old_pending_upload.storage_path)
    assert set(LearnerUpload.objects.values_list("pk", flat=True)) == {old_sent_upload.pk, recent_pending_upload.pk}


@pytest.mark.django_db
def test_get_owned_uploads_returns_uploads_in_requested_order():
    """Matching uploads are returned in the order of the requested IDs."""
    first_upload = save_test_upload()
    second_upload = save_test_upload()

    owned_uploads = upload_storage.get_owned_uploads(
        LEARNER_ID, USAGE_KEY, "shortanswer",
        [str(second_upload.upload_id), str(first_upload.upload_id)],
        state=LearnerUpload.State.PENDING,
    )

    assert owned_uploads == [second_upload, first_upload]


@pytest.mark.django_db
@pytest.mark.parametrize("user_id, usage_key, pane, state", [
    (OTHER_LEARNER_ID, USAGE_KEY, "shortanswer", LearnerUpload.State.PENDING),
    (LEARNER_ID, OTHER_USAGE_KEY, "shortanswer", LearnerUpload.State.PENDING),
    (LEARNER_ID, USAGE_KEY, "workspace", LearnerUpload.State.PENDING),
    (LEARNER_ID, USAGE_KEY, "shortanswer", LearnerUpload.State.SENT),
], ids=["other-user", "other-block", "other-pane", "other-state"])
def test_get_owned_uploads_rejects_other_user_block_pane_or_state(user_id, usage_key, pane, state):
    """An upload that doesn't match every filter isn't returned."""
    owned_upload = save_test_upload()
    other_upload = save_test_upload()

    with pytest.raises(UploadNotFound):
        upload_storage.get_owned_uploads(
            user_id, usage_key, pane, [str(owned_upload.upload_id), str(other_upload.upload_id)], state,
        )


@pytest.mark.django_db
@pytest.mark.parametrize("requested_ids", [["not-a-uuid"], ["{upload_id}", "{upload_id}"]], ids=["invalid", "repeated"])
def test_get_owned_uploads_rejects_invalid_or_repeated_ids(requested_ids):
    """IDs that aren't UUIDs, or that repeat an upload, are rejected."""
    upload = save_test_upload()

    with pytest.raises(UploadNotFound):
        upload_storage.get_owned_uploads(
            LEARNER_ID, USAGE_KEY, "shortanswer",
            [requested_id.format(upload_id=upload.upload_id) for requested_id in requested_ids],
            LearnerUpload.State.PENDING,
        )


@pytest.mark.django_db
def test_delete_pending_upload_removes_row_and_object():
    """Removing a pending upload deletes its row and its stored object."""
    upload = save_test_upload()

    upload_storage.delete_pending_upload(LEARNER_ID, USAGE_KEY, "shortanswer", str(upload.upload_id))

    assert not LearnerUpload.objects.filter(pk=upload.pk).exists()
    assert not default_storage.exists(upload.storage_path)


@pytest.mark.django_db
def test_delete_pending_upload_rejects_sent_upload():
    """A sent upload can't be removed, and is left untouched."""
    upload = mark_test_upload_sent(save_test_upload())

    with pytest.raises(UploadNotFound):
        upload_storage.delete_pending_upload(LEARNER_ID, USAGE_KEY, "shortanswer", str(upload.upload_id))

    assert LearnerUpload.objects.filter(pk=upload.pk).exists()
    assert default_storage.exists(upload.storage_path)


@pytest.mark.django_db
def test_delete_pending_uploads_in_block_leaves_sent_uploads():
    """Reset deletes every pending upload of the learner in this block, in all panes, and keeps sent ones."""
    save_test_upload(pane="workspace")
    save_test_upload(pane="coach")
    sent_upload = mark_test_upload_sent(save_test_upload(pane="workspace"))
    other_block_upload = save_test_upload(usage_key=OTHER_USAGE_KEY)

    deleted_count = upload_storage.delete_pending_uploads_in_block(LEARNER_ID, USAGE_KEY)

    assert deleted_count == 2
    assert set(LearnerUpload.objects.values_list("pk", flat=True)) == {sent_upload.pk, other_block_upload.pk}
    assert default_storage.exists(sent_upload.storage_path)


@pytest.mark.django_db
def test_delete_uploads_ignores_missing_objects():
    """Rows are deleted even when their stored object is already gone."""
    upload = save_test_upload()
    default_storage.delete(upload.storage_path)

    deleted_count = upload_storage.delete_pending_uploads_in_block(LEARNER_ID, USAGE_KEY)

    assert deleted_count == 1
    assert not LearnerUpload.objects.exists()


@pytest.mark.django_db
def test_mark_sent():
    """Only the given uploads are marked as sent."""
    first_upload = save_test_upload()
    second_upload = save_test_upload()

    assert upload_storage.mark_sent([str(first_upload.upload_id)])

    first_upload.refresh_from_db()
    second_upload.refresh_from_db()
    assert first_upload.state == LearnerUpload.State.SENT
    assert second_upload.state == LearnerUpload.State.PENDING


@pytest.mark.django_db
def test_mark_sent_marks_none_if_any_is_already_sent():
    sent_upload = save_test_upload()
    pending_upload = save_test_upload()
    upload_storage.mark_sent([str(sent_upload.upload_id)])

    assert not upload_storage.mark_sent([str(pending_upload.upload_id), str(sent_upload.upload_id)])

    pending_upload.refresh_from_db()
    assert pending_upload.state == LearnerUpload.State.PENDING


@pytest.mark.django_db
def test_mark_pending():
    upload = save_test_upload()
    upload_storage.mark_sent([str(upload.upload_id)])

    upload_storage.mark_pending([str(upload.upload_id)])

    upload.refresh_from_db()
    assert upload.state == LearnerUpload.State.PENDING


@pytest.mark.django_db
def test_read_upload_bytes_missing_object_raises():
    """Reading an upload whose object is gone raises ``UploadNotFound``."""
    upload = save_test_upload()
    default_storage.delete(upload.storage_path)

    with pytest.raises(UploadNotFound):
        upload_storage.read_upload_bytes(str(upload.upload_id))


@pytest.mark.django_db
def test_read_upload_bytes_missing_row_raises():
    """Reading an upload whose row is gone (for example, after retirement) raises ``UploadNotFound``."""
    with pytest.raises(UploadNotFound):
        upload_storage.read_upload_bytes(str(uuid.uuid4()))


@pytest.mark.django_db
def test_retire_user_uploads_deletes_all_courses_and_states():
    """Retirement deletes every upload of the user, and only theirs."""
    pending_upload = save_test_upload()
    sent_upload = mark_test_upload_sent(save_test_upload(pane="coach"))
    other_course_upload = save_test_upload(
        course_key="course-v1:OpenCraft+AI102+2026",
        usage_key="block-v1:OpenCraft+AI102+2026+type@coach_ai_eval+block@first",
        pane="workspace",
    )
    other_learner_upload = save_test_upload(user_id=OTHER_LEARNER_ID)

    retired_count = upload_storage.retire_user_uploads(LEARNER_ID)

    assert retired_count == 3
    assert list(LearnerUpload.objects.values_list("pk", flat=True)) == [other_learner_upload.pk]
    for retired_upload in (pending_upload, sent_upload, other_course_upload):
        assert not default_storage.exists(retired_upload.storage_path)
    assert default_storage.exists(other_learner_upload.storage_path)


@pytest.mark.django_db
def test_retire_user_uploads_ignores_missing_objects():
    """Retirement succeeds when some objects are already gone, so a failed step can be re-run."""
    missing_object_upload = save_test_upload()
    stored_upload = save_test_upload()
    default_storage.delete(missing_object_upload.storage_path)

    retired_count = upload_storage.retire_user_uploads(LEARNER_ID)

    assert retired_count == 2
    assert not LearnerUpload.objects.exists()
    assert not default_storage.exists(stored_upload.storage_path)


@pytest.mark.django_db
def test_no_missing_migrations():
    """The migrations match the models."""
    call_command("makemigrations", "ai_eval", "--check", "--dry-run")
