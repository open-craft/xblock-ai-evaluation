# noqa
# pylint: skip-file
# From https://github.com/open-craft/problem-builder/blob/v5.2.0/problem_builder/instructor_tool.py

#
# Copyright (c) 2014-2015 Harvard, edX & OpenCraft
#
# This software's license gives you freedom; you can copy, convey,
# propagate, redistribute and/or modify this program under the terms of
# the GNU Affero General Public License (AGPL) as published by the Free
# Software Foundation (FSF), either version 3 of the License, or (at your
# option) any later version of the AGPL published by the FSF.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero
# General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program in a file in the toplevel directory called
# "AGPLv3".  If not, see <http://www.gnu.org/licenses/>.
#
"""
Instructor Tool: An XBlock for instructors to export student answers from a course.

All processing is done offline.
"""
import json
import pkg_resources

from django.utils.translation import gettext_noop as _
from web_fragments.fragment import Fragment
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Dict, Scope, String
from xblock.utils.resources import ResourceLoader

loader = ResourceLoader(__name__)


@XBlock.wants('user')
class DataExportXBlock(XBlock):
    icon_class = "problem"
    display_name = String(
        default=_("AI XBlocks data export"),
        scope=Scope.settings
    )
    active_export_task_id = String(
        # The UUID of the celery AsyncResult for the most recent export,
        # IF we are sill waiting for it to finish
        default="",
        scope=Scope.user_state,
    )
    last_export_result = Dict(
        # The info dict returned by the most recent successful export.
        # If the export failed, it will have an "error" key set.
        default=None,
        scope=Scope.user_state,
    )

    has_author_view = True

    def author_view(self, context=None):
        """ Studio View """
        # Warn the user that this block will only work from the LMS. (Since the CMS uses
        # different celery queues; our task listener is waiting for tasks on the LMS queue)
        return Fragment('<p>Data Export Block</p><p>This block only works from the LMS.</p>')

    def studio_view(self, context=None):
        """ View for editing Instructor Tool block in Studio. """
        # Display friendly message explaining that the block is not editable.
        return Fragment('<p>This is a preconfigured block. It is not editable.</p>')

    def check_pending_export(self):
        """
        If we're waiting for an export, see if it has finished, and if so, get the result.
        """
        from .tasks import export_data as export_data_task
        if self.active_export_task_id:
            async_result = export_data_task.AsyncResult(self.active_export_task_id)
            if async_result.ready():
                self._save_result(async_result)

    def _save_result(self, task_result):
        """ Given an AsyncResult or EagerResult, save it. """
        self.active_export_task_id = ''
        if task_result.successful():
            self.last_export_result = task_result.result
        else:
            self.last_export_result = {'error': str(task_result.result)}

    def resource_string(self, path):
        """Handy helper for getting resources from our kit."""
        data = pkg_resources.resource_string(__name__, path)
        return data.decode("utf8")

    def student_view(self, context=None):
        """ Normal View """
        if not self.user_is_staff():
            return Fragment('<p>This interface can only be used by course staff.</p>')

        html = loader.render_django_template('templates/export.html')
        frag = Fragment(html)
        frag.add_javascript(self.resource_string("static/js/src/export.js"))
        frag.initialize_js('DataExportXBlock')
        return frag

    @property
    def download_url_for_last_report(self):
        """ Get the URL for the last report, if any """
        # Unfortunately this is a bit inefficient due to the ReportStore API
        if not self.last_export_result or 'error' in self.last_export_result:
            return None
        from lms.djangoapps.instructor_task.models import ReportStore
        report_store = ReportStore.from_config(config_name='GRADES_DOWNLOAD')
        course_key = getattr(self.scope_ids.usage_id, 'course_key', None)
        return dict(report_store.links_for(course_key)).get(self.last_export_result['report_filename'])

    def _get_status(self):
        self.check_pending_export()
        return {
            'export_pending': bool(self.active_export_task_id),
            'last_export_result': self.last_export_result,
            'download_url': self.download_url_for_last_report,
        }

    def raise_error(self, code, message):
        """
        Raises an error and marks the block with a simulated failed task dict.
        """
        self.last_export_result = {
            'error': message,
        }
        raise JsonHandlerError(code, message)

    @XBlock.json_handler
    def get_status(self, data, suffix=''):
        return self._get_status()

    @XBlock.json_handler
    def delete_export(self, data, suffix=''):
        self._delete_export()
        return self._get_status()

    def _delete_export(self):
        if not self.last_export_result or 'error' in self.last_export_result:
            return
        filename = self.last_export_result['report_filename']
        from lms.djangoapps.instructor_task.models import ReportStore
        report_store = ReportStore.from_config(config_name='GRADES_DOWNLOAD')
        course_key = getattr(self.scope_ids.usage_id, 'course_key', None)
        path = report_store.path_to(course_key, filename)
        try:
            report_store.storage.delete(path)
        except NotImplementedError:
            pass
        self.last_export_result = None

    @XBlock.json_handler
    def start_export(self, data, suffix=''):
        """ Start a new asynchronous export """
        if not self.user_is_staff():
            raise JsonHandlerError(403, "Permission denied.")

        # Launch task
        from .tasks import export_data as export_data_task
        self._delete_export()
        # Make sure we nail down our state before sending off an asynchronous task.
        self.save()
        async_result = export_data_task.delay(
            # course_id not available in workbench.
            str(getattr(self.runtime, 'course_id', 'course_id')),
        )
        if async_result.ready():
            # In development mode, the task may have executed synchronously.
            # Store the result now, because we won't be able to retrieve it later :-/
            if async_result.successful():
                # Make sure the result can be represented as JSON, since the non-eager celery
                # requires that
                json.dumps(async_result.result)
            self._save_result(async_result)
        else:
            # The task is running asynchronously. Store the result ID so we can query its progress:
            self.active_export_task_id = async_result.id
        return self._get_status()

    @XBlock.json_handler
    def cancel_export(self, request, suffix=''):
        from .tasks import export_data as export_data_task
        if self.active_export_task_id:
            async_result = export_data_task.AsyncResult(self.active_export_task_id)
            async_result.revoke()
            self._delete_export()

    def _get_user_attr(self, attr):
        """Get an attribute of the current user."""
        user_service = self.runtime.service(self, 'user')
        if user_service:
            # May be None when creating bok choy test fixtures
            return user_service.get_current_user().opt_attrs.get(attr)
        return None

    def user_is_staff(self):
        """Return a Boolean value indicating whether the current user is a member of staff."""
        return self._get_user_attr('edx-platform.user_is_staff')
