/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { LogService, TestService } from '@salesforce/apex-node';
import {
  ApexTestResultData,
  SyncTestConfiguration,
  TestItem,
  TestResult
} from '@salesforce/apex-node/lib/src/tests/types';
import { Connection } from '@salesforce/core';
import { ContinueResponse } from '@salesforce/salesforcedx-utils-vscode/out/src/types';
import * as path from 'path';
import { nls } from '../messages';
import {
  getLogDirPath,
  LibraryCommandletExecutor,
  notificationService,
  workspaceContext
} from '../utils';
import { launchFromLogFile } from './launchFromLogFile';
import { TraceFlags } from './traceFlags';

interface TestRunResult {
  logFileId?: string;
  message?: string;
  success: boolean;
}

interface LogFileRetrieveResult {
  filePath?: string;
  success: boolean;
}

export class QuickLaunch {
  public async debugTest(
    testClass: string,
    testName?: string
  ): Promise<boolean> {
    const connection = await workspaceContext.getConnection();
    const flags = new TraceFlags(connection);
    if (!(await flags.ensureTraceFlags())) {
      return false;
    }

    const testResult = await this.runSingleTest(
      connection,
      testClass,
      testName
    );

    if (testResult.success && testResult.logFileId) {
      const logFileRetrive = await this.retrieveLogFile(
        connection,
        testResult.logFileId
      );

      if (logFileRetrive.success && logFileRetrive.filePath) {
        launchFromLogFile(logFileRetrive.filePath, false);
        return true;
      }
    } else if (testResult.message) {
      notificationService.showErrorMessage(testResult.message);
    }
    return false;
  }

  private async runSingleTest(
    connection: Connection,
    testClass: string,
    testMethod?: string
  ): Promise<TestRunResult> {
    const testOptions: SyncTestConfiguration = {
      tests: [
        {
          className: testClass,
          testMethods: testMethod ? [testMethod] : undefined
        } as TestItem
      ],
      testLevel: 'RunSpecifiedTests'
    };

    const testService = new TestService(connection);
    try {
      const result: TestResult = await testService.runTestSynchronous(
        testOptions
      );
      const tests: ApexTestResultData[] = result.tests;
      if (tests.length === 0) {
        return {
          success: false,
          message: nls.localize('debug_test_no_results_found')
        };
      }
      if (!tests[0].apexLogId) {
        return {
          success: false,
          message: nls.localize('debug_test_no_debug_log')
        };
      }

      return { logFileId: tests[0].apexLogId, success: true };
    } catch (e) {
      return { message: e.message, success: false };
    }
  }

  private async retrieveLogFile(
    connection: Connection,
    logId: string
  ): Promise<LogFileRetrieveResult> {
    const logService = new LogService(connection);
    const outputDir = getLogDirPath();

    await logService.getLogs({ logId, outputDir });
    const logPath = path.join(outputDir, `${logId}.log`);
    return { filePath: logPath, success: true };
  }
}

class TestDebuggerExecutor extends LibraryCommandletExecutor<string[]> {
  protected executionName = nls.localize('debug_test_exec_name');
  protected logName = 'debug_test_replay_debugger';

  public async run(response: ContinueResponse<string[]>): Promise<boolean> {
    if (!response.data) {
      return false;
    }

    const className = response.data[0];
    const methodName = response.data[1];
    const quickLaunch = new QuickLaunch();
    const success = await quickLaunch.debugTest(className, methodName);

    return success;
  }
}

export async function setupAndDebugTests(
  className: string,
  methodName?: string
): Promise<void> {
  const executor = new TestDebuggerExecutor();
  const response = {
    type: 'CONTINUE',
    data: [className, methodName]
  } as ContinueResponse<string[]>;
  await executor.execute(response);
}
