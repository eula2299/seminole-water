import unittest
from national.acquisition_scheduler import choose_job, transfer_timeout, retryable_server_error


def job(ident, status='pending', attempts=0, start='2025-01-01', end='2025-12-31', error=None):
    return {'partition': {'id':ident, 'state':'FL', 'start':start, 'end':end},
            'status':status, 'attempts':attempts, 'error':error}


class SchedulingTests(unittest.TestCase):
    def test_retry_gets_a_slot_despite_thousands_of_untouched_intervals(self):
        jobs=[job(str(i),start='1900-01-01') for i in range(7112)]
        jobs.append(job('failed', 'failed', 1))
        self.assertEqual(choose_job(jobs, 0)['partition']['id'], 'failed')
        self.assertNotEqual(choose_job(jobs, 1)['partition']['id'], 'failed')
        self.assertEqual(choose_job(jobs, 4)['partition']['id'], 'failed')

    def test_retry_cannot_starve_new_work(self):
        jobs=[job('new'), job('retry','failed',1)]
        self.assertEqual(sum(choose_job(jobs,i)['partition']['id']=='new' for i in range(4)), 3)

    def test_exhausted_or_completed_jobs_are_never_reacquired(self):
        self.assertIsNone(choose_job([job('failed','failed',3),job('done','complete',1),job('split','split',1)]))

    def test_available_queue_is_used_without_waiting(self):
        self.assertEqual(choose_job([job('retry','failed',1)],1)['partition']['id'],'retry')
        self.assertEqual(choose_job([job('new')],0)['partition']['id'],'new')

    def test_selected_job_is_a_copy_and_order_is_deterministic(self):
        original=job('a'); selected=choose_job([original]); selected['attempts']=2
        self.assertEqual(original['attempts'],0)
        self.assertEqual(choose_job([job('old',start='1900-01-01'),job('new')])['partition']['id'],'new')

    def test_single_day_timeout_backoff_is_bounded_without_extra_attempts(self):
        for attempt,expected in [(0,45),(1,90),(2,180),(8,180)]:
            self.assertEqual(transfer_timeout(job('day','failed',attempt,'2025-02-05','2025-02-05','WQP transfer time budget exceeded after 3 attempts; split the date interval.')),expected)
        self.assertEqual(transfer_timeout(job('month','failed',2,error='timed out')),45)
        self.assertEqual(transfer_timeout(job('day','failed',2,'2025-02-05','2025-02-05','Invalid chemical value')),45)

    def test_only_explicit_upstream_5xx_is_adaptively_split(self):
        self.assertTrue(retryable_server_error('Source transfer failed after 3 attempts: HTTP Error 500: Internal Server Error'))
        for msg in ['HTTP Error 500', 'Source transfer failed after 3 attempts: HTTP Error 404: Not Found', 'bad CSV', None]:
            self.assertFalse(retryable_server_error(msg))

if __name__=='__main__':unittest.main()
